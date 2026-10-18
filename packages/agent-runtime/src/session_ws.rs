use super::*;
use crate::sessions::{wire::*, SessionOwner};
use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    http::Uri,
    routing::get,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;

#[derive(Clone)]
struct Lease {
    owner: SessionOwner,
    session: String,
    attachment: String,
}

pub(super) fn route() -> axum::routing::MethodRouter<Arc<HttpState>> {
    get(upgrade)
}

async fn upgrade(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    uri: Uri,
    socket: WebSocketUpgrade,
) -> Response {
    let origin = single_header(&headers, "origin");
    if uri.path_and_query().map(|uri| uri.as_str()) != Some("/sessions")
        || single_header(&headers, "host") != Some(state.host.as_str())
        || !origin.is_some_and(|origin| {
            origin == FRONTEND_ORIGIN
                || origin == FRONTEND_ORIGIN_LOCALHOST
                || origin == state.origin
        })
    {
        return reject(StatusCode::FORBIDDEN, "Use the local Agentica frontend.");
    }
    let Ok(permit) = state.session_connections.clone().try_acquire_owned() else {
        return reject(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many session connections.",
        );
    };
    socket
        .max_message_size(MAX_SESSION_WIRE_BYTES)
        .max_frame_size(MAX_SESSION_WIRE_BYTES)
        .write_buffer_size(MAX_FRAME_BYTES)
        .max_write_buffer_size(MAX_SESSION_WIRE_BYTES)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            connection(socket, state).await;
        })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Auth {
    op: String,
    key: String,
}

async fn connection(mut socket: WebSocket, state: Arc<HttpState>) {
    let first = tokio::time::timeout(Duration::from_secs(3), socket.recv()).await;
    let Ok(Some(Ok(Message::Text(text)))) = first else {
        return;
    };
    if text.len() > 1024 {
        return;
    }
    let Ok(auth) = serde_json::from_str::<Auth>(&text) else {
        return;
    };
    if auth.op != "auth"
        || !bool::from(
            state
                .credential
                .as_slice()
                .ct_eq(format!("Bearer {}", auth.key).as_bytes()),
        )
    {
        return;
    }
    if !matches!(
        tokio::time::timeout(
            Duration::from_secs(2),
            socket.send(Message::Text("{\"event\":\"ready\"}".into())),
        )
        .await,
        Ok(Ok(()))
    ) {
        return;
    }
    let (mut outgoing, mut incoming) = socket.split();
    let (control, mut controls) = tokio::sync::mpsc::channel::<Message>(32);
    let (output, mut outputs) = tokio::sync::mpsc::channel::<Message>(16);
    let leases = Arc::new(std::sync::Mutex::new(Vec::<Lease>::new()));
    let mut writer = tokio::spawn(async move {
        loop {
            let message = tokio::select! { biased;
                message = controls.recv() => message,
                message = outputs.recv() => message,
            };
            let Some(message) = message else {
                break;
            };
            if !matches!(
                tokio::time::timeout(Duration::from_secs(2), outgoing.send(message)).await,
                Ok(Ok(()))
            ) {
                break;
            }
        }
    });
    let service = state.sessions.clone();
    let stream_leases = leases.clone();
    let streamer = tokio::spawn(async move {
        let mut last = std::collections::HashMap::<String, (String, Instant)>::new();
        loop {
            tokio::time::sleep(Duration::from_millis(20)).await;
            let current = match stream_leases.lock() {
                Ok(leases) => leases.clone(),
                Err(_) => break,
            };
            last.retain(|id, _| current.iter().any(|lease| &lease.attachment == id));
            for lease in current {
                let Ok(permit) = output.try_reserve() else {
                    continue;
                };
                let (service, item) = (service.clone(), lease.clone());
                let event = tokio::task::spawn_blocking(move || {
                    service.event(&item.owner, &item.session, &item.attachment)
                })
                .await;
                let Ok(Ok(event)) = event else {
                    continue;
                };
                let status = serde_json::to_string(&event.status).unwrap_or_default();
                if event.output.frames.is_empty()
                    && !event.output.history_gap
                    && last.get(&lease.attachment).is_some_and(|(previous, time)| {
                        previous == &status && time.elapsed() < Duration::from_secs(1)
                    })
                {
                    continue;
                }
                let Ok(encoded) = serde_json::to_string(&event) else {
                    break;
                };
                if encoded.len() > MAX_SESSION_WIRE_BYTES {
                    break;
                }
                last.insert(lease.attachment.clone(), (status, Instant::now()));
                permit.send(Message::Text(encoded.into()));
            }
        }
    });
    let mut rate_started = Instant::now();
    let mut rate_count = 0;
    let inflight = Arc::new(tokio::sync::Semaphore::new(16));
    loop {
        let message = tokio::select! {
            message = incoming.next() => message,
            _ = &mut writer => break,
        };
        let Some(Ok(message)) = message else {
            break;
        };
        if rate_started.elapsed() >= Duration::from_secs(1) {
            rate_started = Instant::now();
            rate_count = 0;
        }
        rate_count += 1;
        if rate_count > MAX_SESSION_MESSAGES_PER_SECOND {
            break;
        }
        let text = match message {
            Message::Text(text) => text,
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) => continue,
            _ => break,
        };
        let Ok(request) = SessionRequest::parse(text.as_bytes()) else {
            break;
        };
        if let Some((owner, session, attachment)) = request.command.attachment() {
            let valid = leases.lock().is_ok_and(|leases| {
                leases.iter().any(|lease| {
                    &lease.owner == owner
                        && lease.session == session
                        && lease.attachment == attachment
                })
            });
            if !valid {
                break;
            }
        }
        let subscription = match &request.command {
            SessionCommand::Subscribe {
                owner, session_id, ..
            } => {
                if leases
                    .lock()
                    .map_or(true, |leases| leases.len() >= MAX_CONNECTION_SUBSCRIPTIONS)
                {
                    break;
                }
                Some((owner.clone(), session_id.clone()))
            }
            _ => None,
        };
        let detach = match &request.command {
            SessionCommand::Detach { attachment_id, .. } => Some(attachment_id.clone()),
            _ => None,
        };
        let is_restart = matches!(request.command, SessionCommand::Restart { .. });
        let (service, replies) = (state.sessions.clone(), control.clone());
        let id = request.id;
        let Ok(permit) = inflight.clone().try_acquire_owned() else {
            break;
        };
        let task = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            (id, service.execute(request.command))
        });
        if is_restart {
            tokio::spawn(async move {
                if let Ok((id, result)) = task.await {
                    let _ = replies.send(reply(&id, result)).await;
                }
            });
            continue;
        }
        let Ok((id, result)) = task.await else {
            break;
        };
        let new_lease = if let (Some((owner, session)), Ok(value)) = (subscription, &result) {
            value["attachmentId"].as_str().map(|attachment| Lease {
                owner,
                session,
                attachment: attachment.into(),
            })
        } else {
            None
        };
        if let Some(id) = detach {
            if let Ok(mut leases) = leases.lock() {
                leases.retain(|lease| lease.attachment != id);
            }
        }
        if control.send(reply(&id, result)).await.is_err() {
            if let Some(lease) = new_lease {
                state
                    .sessions
                    .release(&lease.owner, &lease.session, &lease.attachment);
            }
            break;
        }
        // The writer prioritizes the queued reply. Only then expose this lease
        // to the output worker, so initial output cannot outrun subscribe's reply.
        if let Some(lease) = new_lease {
            if let Ok(mut leases) = leases.lock() {
                leases.push(lease);
            } else {
                state
                    .sessions
                    .release(&lease.owner, &lease.session, &lease.attachment);
                break;
            }
        }
    }
    streamer.abort();
    writer.abort();
    if let Ok(leases) = leases.lock() {
        for lease in leases.iter() {
            state
                .sessions
                .release(&lease.owner, &lease.session, &lease.attachment);
        }
    };
}

fn reply(id: &str, result: Result<serde_json::Value, crate::store::RuntimeError>) -> Message {
    let response = match result {
        Ok(result) => serde_json::json!({"id": id, "result": result}),
        Err(error) => {
            serde_json::json!({"id": id, "error": {"code": error.code, "message": error.message}})
        }
    };
    let mut text = response.to_string();
    if text.len() > MAX_SESSION_WIRE_BYTES {
        text = serde_json::json!({"id": id, "error": {"code": "FRAME_TOO_LARGE", "message": "Session response is too large."}}).to_string();
    }
    Message::Text(text.into())
}
