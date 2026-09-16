# Deploy runbooks

Production origin restore and product deploys for the current OpenBitFun host
(`ssh lwb`).

| Directory | Use |
| --- | --- |
| [openbitfun-host/](openbitfun-host/README.md) | New-host restore: website, release mirror, Relay Nginx, New API boundary |
| [miniapp-market/](miniapp-market/README.md) | MiniApp market only |
| [skin-market/](skin-market/README.md) | Skin market only |
| [outbound-mail/](outbound-mail/README.md) | Send-only Postfix/OpenDKIM: auth integration, DNS, maintenance and rollback |

An Agent that is asked to move or rebuild the server starts at
`openbitfun-host/AGENTS.md`.
