use crate::pty::PtyState;
use crate::rpc::RpcState;

pub struct AppState {
    pub rpc: RpcState,
    pub pty: PtyState,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            rpc: RpcState::default(),
            pty: PtyState::default(),
        }
    }
}
