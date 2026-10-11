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
use tokio::net::TcpListener;

use crate::{handle_request, MAX_FRAME_BYTES};

pub const FRONTEND_ORIGIN: &str = "http://127.0.0.1:1420";
pub const BACKEND_PORT: u16 = 1421;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

struct HttpState {
    host: String,
    credential: Vec<u8>,
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
    let local = single_header(request.headers(), "host") == Some(state.host.as_str())
        && single_header(request.headers(), "origin") == Some(FRONTEND_ORIGIN);
    let mut response = if local {
        match tokio::time::timeout(REQUEST_TIMEOUT, dispatch_local(&state, request)).await {
            Ok(response) => response,
            Err(_) => reject(StatusCode::REQUEST_TIMEOUT, "Request timed out."),
        }
    } else {
        reject(StatusCode::FORBIDDEN, "Use the local Agentica frontend.")
    };
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if local {
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static(FRONTEND_ORIGIN),
        );
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    response
}

async fn dispatch_local(state: &HttpState, request: Request) -> Response {
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
    match to_bytes(request.into_body(), MAX_FRAME_BYTES).await {
        Ok(bytes) => Json(handle_request(&bytes)).into_response(),
        Err(error)
            if error
                .source()
                .is_some_and(|source| source.is::<http_body_util::LengthLimitError>()) =>
        {
            reject(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Requests must fit in 16 KiB.",
            )
        }
        Err(_) => reject(StatusCode::BAD_REQUEST, "Cannot read request body."),
    }
}

/// Serve authenticated loopback RPC with bounded bodies and HTTP header deadlines.
pub async fn serve(listener: TcpListener, connection_key: &str) -> io::Result<()> {
    if !listener.local_addr()?.ip().is_loopback() {
        return Err(io::Error::other("The backend must bind to loopback."));
    }
    let app = Router::new()
        .fallback(dispatch)
        .with_state(Arc::new(HttpState {
            host: format!("127.0.0.1:{}", listener.local_addr()?.port()),
            credential: format!("Bearer {connection_key}").into_bytes(),
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
            let _ = http.serve_connection(TokioIo::new(stream), service).await;
        });
    }
}
