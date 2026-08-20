[English](README.md) | **Suomi**

# DDN — Deterministic Decision Network -referenssitoteutus

Avoimen lähdekoodin referenssiarkkitehtuuri kryptografisesti todennettaville
päätöksille, jotka suorittaa deterministinen, versioitu liiketoimintasääntö.

DDN on referenssitoteutus, ei tuotantovalidaattoriverkko, eikä osoitus siitä,
että taustalla oleva liiketoimintasääntö on oikea, reilu, lainmukainen tai
sopiva tiettyyn käyttötarkoitukseen. Se näyttää konkreettisesti, miltä
deterministinen policyn suoritus yhdistettynä kynnysarvopohjaisesti
allekirjoitettuun attestointiin ja auditoitaviin päätöskuitteihin voi
näyttää päästä päähän — policy-as-code-määrittelystä riippumattomaan
kuitin todentamiseen asti, ilman että kenenkään tarvitsee luottaa
koordinaattorin omaan väitteeseen siitä, että päätös on lopullinen.

## Mikä DDN on

Referenssipino käynnistää yhden Rust-validaattoribinäärin kolmena
eristettynä aliprosessina samalla hostilla. Päätös hyväksytään vain, kun
vähintään kaksi konfiguroidun kolmen jäsenen trusted validator setin
jäsentä tuottaa keskenään yhtenevän Ed25519-allekirjoitetun attestoinnin
samasta suoritustuloksesta. Kyseessä on kiinteä 2-of-3-luottamusmalli, ei
permissionless-verkko eikä riippumattomien operaattoreiden välinen
Byzantine-fault-tolerant-konsensusprotokolla.

Hyväksytty päätös tuottaa sisältöosoitteisen `DecisionReceiptV1`-kuitin.
Kuitti sisältää kunkin hyväksyvän validaattorin Ed25519-allekirjoitetun
attestoinnin; koordinaattori ei lisää erillistä allekirjoitusta koko
kuitin ylle. Standardi verifier tarkistaa attestoinnit, kynnyksen,
request-bindingit, hashit, Merkle-todisteen ja konfiguroidun EVM-ankkurin.
Policyn semantiikan uudelleensuoritus vaatii erillisen
`replay-verify`-polun ja täsmällisen policy-paketin.

Repositorio sisältää canonical JSON- ja crypto-toteutukset, WebAssemblyksi
käännetyn deterministisen neuvottelupolicyn, TypeScript-API:n ja SDK:t,
kuittiverifierin, Merkle-batchauksen, Solidity-ankkurisopimuksen ja
selaindemon. Blocking full-chain E2E käyttää oikeita
validaattorialiprosesseja, API:a, selainsovelluksia, paikallista
Anvil-ketjua ja sopimusta ilman mockeja. Tämä väite ei koske jokaista
yksikkötestiä.

## Kenelle referenssi on tarkoitettu

Referenssi on tarkoitettu insinööreille ja arkkitehdeille, jotka arvioivat
arkkitehtuurimalleja automaattisille päätöksentekojärjestelmille, jotka
tarvitsevat todennettavan jäljen — tiimeille, jotka tutkivat
deterministisen policyn suoritusta, kynnysarvopohjaisesti allekirjoitettua
attestointia tai auditoitavia päätöskuitteja suunnittelumallina, sekä
turvallisuus- tai protokolla-arvioijille, jotka haluavat konkreettisen,
ajettavan artefaktin tutkittavaksi whitepaperin sijaan. Se ei ole
suoraan käyttöönotettava tuotantopalvelu, eikä sitä tarjota sellaisena.

## Mitä päätöskuitti todistaa

Kolmas osapuoli, joka vastaanottaa `DecisionReceiptV1`-kuitin ja ajaa
julkaistun verifierin — luottamatta koordinaattorin "finalized"-väitteeseen
— voi itsenäisesti tarkistaa, että:

- syöte on kanonisoitu ja sidottu täsmällisiin policy-, manifest- ja
  execution-profile-hasheihin;
- vähintään kaksi kolmesta konfiguroidusta trusted-validaattorista on
  itsenäisesti suorittanut saman WASM-policy-paketin ja tuottanut
  keskenään yhtenevät Ed25519-allekirjoitetut attestoinnit tuloksesta;
- kuitin muoto, hashit, request-bindingit, validaattori-identiteetit ja
  -allekirjoitukset sekä konfiguroitu kynnysarvo ovat kaikki voimassa;
- Merkle-todiste sitoo kuitin batch-juureen, ja juuri vastaa sitä, mitä
  konfiguroitu EVM-ankkurisopimus palauttaa konfiguroidun
  RPC-päätepisteen kautta — tähän mennessä osoitettu paikallisella
  Anvil-ketjulla.

## Mitä DDN ei todista

- Että policyyn koodattu liiketoimintasääntö on oikea, reilu, lainmukainen
  tai sopiva tiettyyn käyttötarkoitukseen. DDN todistaa, että policyn
  suoritus tapahtui deterministisesti ja attestoitiin — ei sitä, että
  itse sääntö on hyvä.
- Että tavallinen verifier tarkisti policyn semantiikan. Se ei suorita
  policya; vain erillinen `replay-verify`-polku, täsmällisellä
  policy-paketilla, tekee sen.
- Että kolme validaattoria ovat riippumatonta infrastruktuuria.
  Referenssideploymentissa ne ovat yhden binäärin aliprosesseja samalla
  hostilla saman operaattorin alla, eivät riippumattomien operaattoreiden
  verkko.
- Että ankkuri on julkisesti havaittavissa. Tässä osoitettu EVM-ankkurointi
  ajetaan paikallisella Anvil-ketjulla, ei julkisessa testiverkossa tai
  mainnetissa.
- Että päätöstila säilyy. Koordinaattorin ja ankkurin repositoriot ovat
  muistissa eivätkä säily uudelleenkäynnistyksen yli.
- Että DDN tarjoaa KMS/HSM-pohjaisen avainten säilytyksen, rotaation tai
  peruutuksen. Allekirjoitusavaimet ovat tässä referenssissä
  paikallisia tiedostoja.
- Että DDN arvioi tai varmentaa tekoälymallin vapaamuotoista päättelyä.
  Järjestelmässä, joka hyödyntää myös LLM:ää tai muuta tekoälymallia,
  DDN:n deterministinen policykerros voi toimia auditointirajana niille
  päätöksen osille, jotka on koodattu policy-as-codena — mutta se ei
  varmenna, rajoita eikä auditoi itse mallin päättelyä.
- Että DDN käsittelee maksuja. Ei käsittele.

## Referenssiarkkitehtuuri

- `apps/` — TypeScript-palvelut (`api`, `coordinator`, `anchor-service`,
  `explorer`, `demo-reference`) sekä Rust-validaattoripalvelu
  (`apps/validator`).
- `packages/` — jaetut kirjastot. `canonical-json` ja `crypto` sisältävät
  sekä TypeScript- että Rust-toteutuksen, jotka on ristiinvarmennettu
  toisiaan vasten jaettujen testivektoreiden avulla.
- `policies/` — versioidut päätöspolicyt, kirjoitettu Rustilla, käännetty
  WebAssemblyksi.
- `contracts/` — Foundry (Solidity) -projekti, joka sisältää
  decision-anchor-sopimuksen.
- `infra/` — Dockerfilet toistettaville ja eristetyille
  build-profiileille.

Katso [CONTRIBUTING.md](./CONTRIBUTING.md) täydellinen repositorion
rakenne ja arkkitehtuuripäätökset (ADR:t) hakemistosta `docs/decisions/`.

## Nykyinen näyttö ja rajoitukset

Nykyinen näyttö on tarkoituksella suppea:

- kolme validaattoria ajetaan yhdellä hostilla samalla binäärillä;
- EVM-ankkurointi on osoitettu vain paikallisella Anvil-ketjulla;
- verifier luottaa konfiguroituun RPC-päätepisteeseen eikä ole light
  client;
- repositorio- ja idempotenssitila ovat muistissa eivätkä säily
  uudelleenkäynnistyksen yli;
- KMS/HSM:ää, avainrotaatiota tai riippumattomia validaattorioperaattoreita
  ei ole toteutettu;
- policyn toistettavuus on osoitettu pinnatulle Linux/arm64-profiilille;
  Linux/amd64 on edelleen kokeellinen eikä julkaisuväite;
- DDN ei käsittele maksuja eikä korvaa liiketoimintasääntöä, jota se
  varmentaa;
- tämä referenssitoteutus ei ole aktiivinen tuotantointegraatio.

Lue [luottamusmalli](./docs/trust-model.md),
[tunnetut rajoitukset](./docs/limitations.md) ja
[uhkamalli](./docs/threat-model.md) ennen koodin arviointia tai ajamista.
Vahvistettu julkisen projektin kuvaus löytyy
[englanniksi ja suomeksi](./docs/public-project-description.md).

## Aloittaminen

Katso [CONTRIBUTING.md](./CONTRIBUTING.md) esivaatimukset, koko
repositorion rakenne ja yleiset komennot (`pnpm install`, build/lint/test,
policyn build ja verifiointi sekä oikea end-to-end-testisarja).

## Tietoturva

Katso [SECURITY.md](./SECURITY.md). Älä avaa julkista issueta epäillystä
haavoittuvuudesta — käytä sen sijaan tämän repositorion GitHub Private
Vulnerability Reportingia.
