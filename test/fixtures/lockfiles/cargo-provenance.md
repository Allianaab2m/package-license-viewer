# Cargo fixtures

Generated on 2026-09-12 with Cargo 1.97.0 (c980f4866 2026-06-30).
`cargo.Cargo.lock` was produced by `cargo run` for a temporary binary package
named `plv-cargo-fixtures`, version `0.1.0`, edition `2021`, with the single
dependency `semver = "=1.0.27"`. The fixture is unmodified Cargo output.

`cargo-versionreq.tsv` records requirement, version, and result from Rust
`semver` 1.0.27. Each row is an independent oracle case. To regenerate a row,
parse its first field using `semver::VersionReq::parse`; write `invalid` if
parsing fails, otherwise write `req.matches(&Version::parse(second).unwrap())`.
The matrix covers all eight operators, partial versions, wildcards, prereleases,
build metadata and invalid npm-style syntax. Blank requirements are intentional.
The tests read these saved expectations; they never invoke Cargo.
