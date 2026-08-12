# Public project description

## English

DDN is a reference implementation of a verification layer for significant
decisions made by deterministic, versioned business rules. One Rust validator
binary runs as three isolated child processes on the same host, and the
coordinator accepts a result only when at least two members of the configured
three-key trusted set produce matching Ed25519-signed attestations. The result
is a content-addressed decision receipt. A verifier checks the receipt,
signatures, threshold, request bindings, Merkle proof and a root anchored by a
Solidity contract. The full-chain blocking E2E uses real validator processes
and a local Anvil chain without mocks.

This is not a production or permissionless validator network. The validator
processes share one host and operator; EVM anchoring is demonstrated only on
local Anvil; the verifier trusts its RPC and is not a light client; state is in
memory; and KMS/HSM custody, key rotation and independent operators are not
implemented. DDN does not process payments and does not decide whether a
business rule is correct, fair or lawful.

## Suomi

DDN on referenssitoteutus varmennuskerroksesta determinististen ja
versioitujen liiketoimintasääntöjen merkittäville päätöksille. Yksi
Rust-validaattoribinääri ajetaan kolmena samalla hostilla eristettynä
aliprosessina. Koordinaattori hyväksyy tuloksen vain, kun vähintään kaksi
konfiguroidun kolmen avaimen trusted setin jäsentä tuottaa keskenään
yhtenevän Ed25519-allekirjoitetun attestoinnin. Tuloksena on sisältöosoitteinen
päätöskuitti. Verifier tarkistaa kuitin, allekirjoitukset, kynnyksen,
request-bindingit, Merkle-todisteen ja Solidity-sopimukseen ankkuroidun juuren.
Blocking full-chain E2E käyttää oikeita validaattoriprosesseja ja paikallista
Anvil-ketjua ilman mockeja.

Kyseessä ei ole tuotantokelpoinen tai permissionless validaattoriverkko.
Validaattorit jakavat saman hostin ja operaattorin, EVM-ankkurointi on osoitettu
vain paikallisella Anvil-ketjulla, verifier luottaa RPC-palvelimeen eikä ole
light client, tila on muistissa eikä KMS/HSM-avaintenhallintaa, avainrotaatiota
tai riippumattomia operaattoreita ole toteutettu. DDN ei käsittele maksuja eikä
ratkaise, onko liiketoimintasääntö oikea, reilu tai lainmukainen.
