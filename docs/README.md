# Documentation

Documentation is organized by the job being done. Paths in prose and shell commands are relative to the repository root unless stated otherwise. This layout reflects the source tree reviewed on 2026-10-05; deployed configuration and database state must be checked separately.

| Need | Read |
| --- | --- |
| Install and run | [Root README](../README.md) |
| Find code owners and shared contracts | [Architecture](development/architecture.md) |
| Add characters, modes, powerups, or migrations | [Contributing](development/contributing.md) |
| Run or write tests | [Testing](development/contributing.md#testing) |
| Change movement, bots, or debug combat | [Gameplay](development/gameplay.md) |
| Find or tune a game constant | [Game constants](development/constants.md) |
| Change replication, clocks, or projectile protocols | [Networking](development/networking.md) |
| Change navigation, rendering, loading, or sound | [Client](development/client.md) |
| Edit maps, assets, spawns, or playtests | [Map Studio](development/maps.md) |
| Change rewards, ownership, or player cards | [Progression](development/progression.md) |
| Provision or upgrade the database | [Database](operations/database.md) |
| Deploy, recover, or verify security boundaries | [Deployment](operations/deployment.md) |
| Configure Checkout and webhook processing | [Payments](operations/payments.md) |
| Maintain public content, support, friends, or email | [Services](operations/services.md) |
| Prepare art or find its source prompts | [Art workflow](art/README.md), [prompt provenance](art/provenance.md) |

## Where material belongs

- `docs/development/`: maintained behavior, ownership, extension instructions, and focused verification.
- `docs/operations/`: setup, configuration, deployment, persistence, and recovery.
- `docs/art/`: asset workflow and provenance. Historical prompts are explicitly separated from installed runtime contracts.
- `content/help/`, `content/news/`, `content/legal/`: published application content with manifest-backed URLs. These are not duplicate developer docs; preserve article paths and legal versioning.
- Asset-local READMEs retain sound sources, attribution, and licensing records beside the files. The independently runnable Sprite Workshop keeps its own README.

Update the owning guide when behavior changes. Link to source for exhaustive tuning, schema, and API details rather than copying entire implementations. Add a document only for a distinct audience or workflow; merge small feature notes into the appropriate guide. Retired implementation diaries and one-off QA console scripts are superseded by the maintained guides and executable tests. Do not present past test runs as current verification.
