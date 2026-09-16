# Engine.IO TLS provider selection

Source: crates.io `eioc` 0.5.0, from <https://github.com/Stanley5249/sioc-rs>.
This copy retains the upstream MIT / Apache-2.0 license choice.

The sole source change is in Cargo.toml: `rustls-tls` enables
`reqwest/rustls-no-provider` instead of `reqwest/rustls`.
OpenBitFun selects ring through its existing TLS provider owner. Upstream's
Reqwest feature otherwise forces AWS-LC alongside ring, even when the Socket.IO
client receives OpenBitFun's configured HTTP client. Engine.IO wire behavior is
unchanged. Remove this patch when upstream exposes provider-neutral Rustls.
