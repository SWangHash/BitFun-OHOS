# Deploy runbooks

Production origin restore and product deploys for the current BitFun host
(`ssh lwb`).

| Directory | Use |
| --- | --- |
| [bitfun-host/](bitfun-host/README.md) | New-host restore: website, release mirror, Relay Nginx, New API boundary |
| [miniapp-market/](miniapp-market/README.md) | MiniApp market only |
| [skin-market/](skin-market/README.md) | Skin market only |
| [outbound-mail/](outbound-mail/README.md) | Send-only Postfix/OpenDKIM: auth integration, DNS, maintenance and rollback |

An Agent that is asked to move or rebuild the server starts at
`bitfun-host/AGENTS.md`.
