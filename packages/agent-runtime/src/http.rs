use std::{error::Error, io, sync::Arc, time::Duration};

use axum::{
    body::to_bytes,
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    Json, Router,
};
use hyper_util::{
    rt::{TokioIo, TokioTimer},
    service::TowerToHyperService,
};
use subtle::ConstantTimeEq;
use tokio::{net::TcpListener, sync::Mutex, time::Instant};

use crate::sessions::{wire::MAX_SESSION_CONNECTIONS, SessionService};
use crate::{Runtime, MAX_FRAME_BYTES};
#[path = "session_ws.rs"]
mod session_ws;

pub const FRONTEND_ORIGIN: &str = "http://127.0.0.1:1420";
// Vite serves the same development frontend whether it is opened as 127.0.0.1
// or localhost, so a browser there sends either spelling as its Origin.
pub const FRONTEND_ORIGIN_LOCALHOST: &str = "http://localhost:1420";
pub const BACKEND_PORT: u16 = 1421;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

#[cfg(feature = "bundled-frontend")]
include!(concat!(env!("OUT_DIR"), "/frontend.rs"));

struct HttpState {
    host: String,
    origin: String,
    credential: Vec<u8>,
    // Browser tabs share this runtime; it is the workspace writer.
    runtime: Arc<Mutex<Runtime>>,
    sessions: Arc<SessionService>,
    mcp: Arc<crate::mcp::McpService>,
    session_connections: Arc<tokio::sync::Semaphore>,
    data_root: Option<std::path::PathBuf>,
}

// Reject duplicate security headers instead of trusting whichever value is first.
fn single_header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    value.to_str().ok()
}

fn reject(status: StatusCode, message: &'static str) -> Response {
    (status, message).into_response()
}

async fn dispatch(State(state): State<Arc<HttpState>>, request: Request) -> Response {
    let origin = single_header(request.headers(), "origin");
    let local_host = single_header(request.headers(), "host") == Some(state.host.as_str());
    let local_origin = origin.is_some_and(|origin| {
        origin == FRONTEND_ORIGIN || origin == FRONTEND_ORIGIN_LOCALHOST || origin == state.origin
    });
    let cors_origin = if local_host && local_origin {
        request.headers().get(header::ORIGIN).cloned()
    } else {
        None
    };
    let mut response = if !local_host {
        reject(StatusCode::FORBIDDEN, "Use the local Agentica frontend.")
    } else if request.uri().path() != "/rpc"
        && (local_origin || !request.headers().contains_key("origin"))
    {
        serve_frontend(request)
    } else if local_origin {
        dispatch_local(state, request).await
    } else {
        reject(StatusCode::FORBIDDEN, "Use the local Agentica frontend.")
    };
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(
                    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:1421 https: http://localhost:* http://127.0.0.1:*; frame-src 'self' http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    ));
    if let Some(origin) = cors_origin {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    response
}

fn serve_frontend(request: Request) -> Response {
    #[cfg(feature = "bundled-frontend")]
    if let Some((mime, bytes)) = request
        .uri()
        .path_and_query()
        .and_then(|path| frontend_asset(path.as_str()))
    {
        if !matches!(*request.method(), Method::GET | Method::HEAD) {
            let mut response = reject(StatusCode::METHOD_NOT_ALLOWED, "Use GET or HEAD.");
            response
                .headers_mut()
                .insert(header::ALLOW, HeaderValue::from_static("GET, HEAD"));
            return response;
        }
        let body = if request.method() == Method::HEAD {
            &[][..]
        } else {
            bytes
        };
        let mut response = ([(header::CONTENT_TYPE, mime)], body).into_response();
        response
            .headers_mut()
            .insert(header::CONTENT_LENGTH, HeaderValue::from(bytes.len()));
        return response;
    }
    let _ = request;
    reject(StatusCode::NOT_FOUND, "Unknown endpoint.")
}

async fn dispatch_local(state: Arc<HttpState>, request: Request) -> Response {
    let deadline = Instant::now() + REQUEST_TIMEOUT;
    if request.uri().path_and_query().map(|path| path.as_str()) != Some("/rpc") {
        return reject(StatusCode::NOT_FOUND, "Unknown endpoint.");
    }
    if request.method() == Method::OPTIONS {
        let headers = request.headers();
        let requested_headers =
            single_header(headers, "access-control-request-headers").unwrap_or("");
        if single_header(headers, "access-control-request-method") != Some("POST")
            || headers
                .get_all("access-control-request-headers")
                .iter()
                .count()
                > 1
            || (!requested_headers.is_empty()
                && requested_headers.split(',').any(|name| {
                    !matches!(
                        name.trim().to_ascii_lowercase().as_str(),
                        "authorization" | "content-type"
                    )
                }))
        {
            return reject(StatusCode::FORBIDDEN, "Unsupported preflight.");
        }
        let mut response = StatusCode::NO_CONTENT.into_response();
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("POST"),
        );
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("Authorization, Content-Type"),
        );
        return response;
    }
    let supplied = single_header(request.headers(), "authorization")
        .unwrap_or("")
        .as_bytes();
    if !bool::from(state.credential.as_slice().ct_eq(supplied)) {
        return reject(
            StatusCode::UNAUTHORIZED,
            "Invalid connection key. Copy the current key from the backend terminal.",
        );
    }
    if request.method() != Method::POST {
        let mut response = reject(StatusCode::METHOD_NOT_ALLOWED, "Use POST.");
        response
            .headers_mut()
            .insert(header::ALLOW, HeaderValue::from_static("POST, OPTIONS"));
        return response;
    }
    if single_header(request.headers(), "content-type") != Some("application/json") {
        return reject(StatusCode::UNSUPPORTED_MEDIA_TYPE, "Use application/json.");
    }
    let bytes =
        match tokio::time::timeout_at(deadline, to_bytes(request.into_body(), MAX_FRAME_BYTES))
            .await
        {
            Ok(Ok(bytes)) => bytes,
            Ok(Err(error))
                if error
                    .source()
                    .is_some_and(|source| source.is::<http_body_util::LengthLimitError>()) =>
            {
                return reject(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "Requests must fit in 16 KiB.",
                );
            }
            Ok(Err(_)) => return reject(StatusCode::BAD_REQUEST, "Cannot read request body."),
            Err(_) => return reject(StatusCode::REQUEST_TIMEOUT, "Request timed out."),
        };
    let route = crate::route(&bytes);
    // Read-only Git never waits for, or blocks, the workspace writer.
    if route == crate::Route::Changes {
        let data_root = state.data_root.clone();
        return match tokio::task::spawn_blocking(move || {
            crate::changes::handle_request(data_root.as_deref(), &bytes)
        })
        .await
        {
            Ok(reply) => Json(reply).into_response(),
            Err(_) => reject(StatusCode::INTERNAL_SERVER_ERROR, "Backend runtime failed."),
        };
    }
    // A tool call can wait on a child process for 30 s; it locks the runtime only per step.
    if route == crate::Route::Mcp {
        let (runtime, mcp) = (state.runtime.clone(), state.mcp.clone());
        return match tokio::task::spawn_blocking(move || {
            crate::mcp::handle_request(&mcp, &bytes, &mut |method, params| {
                runtime.blocking_lock().mcp_internal(method, params)
            })
        })
        .await
        {
            Ok(reply) => Json(reply).into_response(),
            Err(_) => reject(StatusCode::INTERNAL_SERVER_ERROR, "Backend runtime failed."),
        };
    }
    let mut runtime =
        match tokio::time::timeout_at(deadline, state.runtime.clone().lock_owned()).await {
            Ok(runtime) => runtime,
            Err(_) => {
                return reject(
                    StatusCode::REQUEST_TIMEOUT,
                    "Request timed out before execution. Nothing was saved.",
                );
            }
        };
    // A started blocking mutation cannot be cancelled; await its committed outcome.
    let sessions = state.sessions.clone();
    let mcp = state.mcp.clone();
    match tokio::task::spawn_blocking(move || {
        let request: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
        let method = request["method"].as_str().unwrap_or("");
        let params = &request["params"];
        match sessions.guard_metadata(method, params) {
            Ok(_guard) => {
                let response = runtime.handle_request(&bytes);
                drop(runtime);
                if response.get("error").is_none() {
                    let _ = crate::after_runtime_success(method, params, &sessions, &mcp);
                }
                response
            }
            Err(error) => serde_json::json!({"protocolVersion": 1, "id": request["id"], "error": {"code": error.code, "message": error.message}}),
        }
    }).await {
        Ok(reply) => Json(reply).into_response(),
        Err(_) => reject(StatusCode::INTERNAL_SERVER_ERROR, "Backend runtime failed."),
    }
}

/// Serve authenticated loopback RPC and optional embedded UI with HTTP deadlines.
pub async fn serve_with_sessions(
    listener: TcpListener,
    connection_key: &str,
    runtime: Runtime,
    sessions: Arc<SessionService>,
) -> io::Result<()> {
    let mcp = Arc::new(crate::mcp::McpService::new());
    serve_with_services(listener, connection_key, runtime, sessions, mcp).await
}

/// Serve with caller-owned session and MCP services, so the caller can stop both on exit.
pub async fn serve_with_services(
    listener: TcpListener,
    connection_key: &str,
    mut runtime: Runtime,
    sessions: Arc<SessionService>,
    mcp: Arc<crate::mcp::McpService>,
) -> io::Result<()> {
    if !listener.local_addr()?.ip().is_loopback() {
        return Err(io::Error::other("The backend must bind to loopback."));
    }
    runtime.set_preview_endpoints(&[
        FRONTEND_ORIGIN.to_owned(),
        format!("http://127.0.0.1:{}", listener.local_addr()?.port()),
    ]);
    let app = Router::new()
        .route("/sessions", session_ws::route())
        .fallback(dispatch)
        .with_state(Arc::new(HttpState {
            host: format!("127.0.0.1:{}", listener.local_addr()?.port()),
            origin: format!("http://127.0.0.1:{}", listener.local_addr()?.port()),
            credential: format!("Bearer {connection_key}").into_bytes(),
            data_root: runtime.data_root().map(std::path::Path::to_owned),
            runtime: Arc::new(Mutex::new(runtime)),
            sessions,
            mcp,
            session_connections: Arc::new(tokio::sync::Semaphore::new(MAX_SESSION_CONNECTIONS)),
        }));
    loop {
        let (stream, _) = listener.accept().await?;
        let service = TowerToHyperService::new(app.clone());
        tokio::spawn(async move {
            // Axum's default serve helper does not expose the header deadline.
            let mut http = hyper::server::conn::http1::Builder::new();
            http.timer(TokioTimer::new())
                .header_read_timeout(REQUEST_TIMEOUT)
                .max_buf_size(MAX_FRAME_BYTES);
            // Peer disconnects and malformed HTTP are ordinary connection errors.
            let _ = http
                .serve_connection(TokioIo::new(stream), service)
                .with_upgrades()
                .await;
        });
    }
}
