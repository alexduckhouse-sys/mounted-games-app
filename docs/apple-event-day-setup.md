# Apple event-day integration

These features are disabled until their settings are supplied. Arrival bookings and the HTML arrival card work without Apple credentials.

## Application wiring

- Call `builder.Services.AddAppleFeatures(builder.Configuration)` and `modelBuilder.ConfigureAppleModels()`.
- Run `AppleFeatures.EnsureAppleSqliteSchema(db)` in the SQLite upgrade path. Generate the combined Postgres migration and idempotent script in the parent integration.
- Mount `NativeLiveActivityCoordinator` once under the app providers. Dispatch `mg:live-progress` after relevant hub updates. `FollowingTab` contains the explicit choice control.
- After a committed progress mutation, call `AppleDeliveryRunner.InvalidateCompetitionAsync(id)`. The registered hosted worker checks every 30 seconds while an instance is running.
- Mount `ArrivalGateLookup` in the staff entries view. `ArrivalBookings competitionId={id} staff` also lists all vehicles, including shop-only customers with no signup. Entry-specific views already mount their own booking control.
- Call `AppleFeatures.DeleteCompetitionAsync` before manual event deletion, and `DeleteAccountAsync` during account erasure. SQLite and Postgres relationships cascade booking sources, allocations, passes and registrations. `ExportAccountAsync` exports owner records without authentication tokens, device identifiers or QR references.
- Register `apple` from each new language catalogue in its language index. Welsh and French copy requires human translation review.

## Deployment prerequisites

Set the following through the existing secret configuration process; no credentials are included in this change:

- `Apple:EncryptionKey`: the same base64-encoded 32-byte AES key on every instance. It protects device push tokens and the stable Wallet authentication token. Preserve it across restarts.
- `Apple:WakeKey`: a shared bearer secret of at least 32 characters. An external scheduler must POST `/api/apple/delivery/wake` while the API is scaled to zero. The worker alone cannot wake a sleeping deployment. Configure a regular wake before enabling either feature.
- Live Activities: `Apple:LiveActivitiesEnabled=true`, `TeamId`, `BundleId`, `ApnsKeyId`, `ApnsPrivateKey` (Apple-issued P8) and `Sandbox`. DEBUG native builds use sandbox; Release builds use production. The app needs the Apple Push Notifications entitlement and matching provisioning.
- Wallet: `Apple:WalletEnabled=true`, `TeamId`, `PassTypeId`, `PassCertificateBase64` (Apple-issued P12 with private key), optional `PassCertificatePassword`, `PassIntermediateBase64` (WWDR certificate), and HTTPS `Sharing:PublicBaseUrl`. The pass type certificate also authenticates Wallet APNs notifications.

The named APNs clients suppress HTTP-client logging because their request paths contain push tokens. Keep ASP.NET request diagnostics at Warning and redact Apple protocol paths in proxy logs.

No APNs request, signed pass installation or real-device background delivery was performed. These require the registered Apple app/pass identifiers, issued certificates, provisioning and a physical iPhone. Verify token rotation, background updates, manual dismissal, expiry, pass installation and pass refresh using those credentials before enabling production.

## Data rules

The catalogue editor explicitly classifies a future purchase and records its first night and exclusive departure date. A dated item must not be reused for a different stay; use a separate item. New order lines snapshot these fields. Historical unclassified lines need competition-staff review. Existing title-based capacity holds remain conservative until that review; they never grant a pass entitlement. A paid entry never creates a stable or hook-up entitlement.

A booking can combine entry admission and purchased benefits, or contain a shop purchase without an entry. Purchased quantities are conserved across vehicles. Allocation is per resource and night, and unique within the event and benefit kind. Refunds, pending payment, test orders and demo events are checked again when a pass or gate record is read. Old signup allocations require explicit reconciliation to paid purchases; the original details are retained for review and become immutable.

Wallet uses one stable serial and authentication token per booking. The token is encrypted at rest; only its digest is used for request checks. Changed-serial responses use a global counter locked and committed with the changes. Every explicit transaction runs as a whole inside EF’s execution strategy. Exhausted serializable database conflicts return HTTP 409. Device updates have durable leases, bounded retries and coalesced latest state. The send boundary is at least once; APNs can accept a request before a worker loses its response.

## Build and verification

The API references `System.Security.Cryptography.Pkcs.dll` from `$(MSBuildToolsPath)` without adding a NuGet dependency. Local .NET 10 SDK and ASP.NET 10 runtime both contain it, and signing code compiles. `Dockerfile.vercel` uses the corresponding .NET 10 SDK and ASP.NET images; it assumes those images expose the same SDK assembly path and runtime assembly. A release container build must verify that assumption before deployment; no image was pulled or deployed for this work.

Focused API tests cover ownership, staff gate access, quantity conservation, competing allocations, explicit seller classification, preserved historical snapshots, paid/pending/refunded/test/demo entitlements, stable Wallet identity and global cursor, and native APNs retry/rotation/dismissal. Web tests cover explicit selection/dismissal and booking edits. The iOS simulator build runs with signing disabled. The parent integration runs the full application checks and coverage gates.
