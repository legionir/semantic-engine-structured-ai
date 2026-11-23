# Process sandbox configuration

Process tools remain disabled by default:

```text
PROCESS_SANDBOX_MODE=deny
```

Select a sandbox explicitly when enabling `terminal_exec` or `process_start`:

- `docker` or `podman`: a Linux container engine must be installed and running. The default image is `node:22-bookworm`; override it with `PROCESS_SANDBOX_IMAGE` if the workspace needs another toolchain.
- `bwrap`: Linux-only bubblewrap sandbox. Network access is isolated.
- `test`: repository test harness only; this runs a host shell with the credential-filtered child environment and is not a production sandbox.

Docker and Podman containers use a read-only root filesystem, drop Linux capabilities, enable `no-new-privileges`, and impose CPU, memory, PID, and temporary-filesystem limits. The workspace is the only writable host bind mount. A named container is force-removed when its client process closes, including timeout/cancellation paths.

Container networking defaults to `PROCESS_SANDBOX_NETWORK=none`. Setting it to `bridge` permits general container egress; it is **not** an egress allowlist and may expose services reachable from the container network. Use it only when the operator intends to allow network access (for example, dependency installation in a trusted workspace). Image pulls are performed by the host container engine before the command starts.

Resource defaults are 2 CPUs, 2048 MiB memory, 256 processes, and a 512 MiB `/tmp` tmpfs. They may be adjusted with `PROCESS_SANDBOX_CPUS`, `PROCESS_SANDBOX_MEMORY_MB`, `PROCESS_SANDBOX_PIDS_LIMIT`, and `PROCESS_SANDBOX_TMP_MB`. These settings, the sandbox mode, image, and network mode are locked against repository project configuration; only the operator may set them.

The container receives a minimal environment (`HOME` and `PATH`); host credentials and arbitrary environment variables are not forwarded. The engine CLI receives only the allowlisted child environment, including the host's engine-selection variables where configured.

## Important limitations

- Docker/Podman mode is opt-in; the runtime does not silently fall back to an unsandboxed host shell if the engine is missing or fails.
- `bridge` networking is broad. Per-domain egress filtering, a Windows-native AppContainer backend, macOS Seatbelt, and sandbox capability reporting are still future P1-2 work.
- The default image is a convenience image, not a universal build image. Configure an operator-controlled image containing the workspace's needed tools.
