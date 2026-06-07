# dataset-srj20-partial-bga-breakouts

Simple-route JSON dataset for partial BGA breakout routing cases. It follows
the same broad conventions as
[`tscircuit/dataset-srj16-bga-breakouts`](https://github.com/tscircuit/dataset-srj16-bga-breakouts):

- samples live in `circuits/sampleNNN/`
- each sample has a `sampleNNN.circuit.simple-route.json`
- each sample also has a tiny `sampleNNN.circuit.tsx` board wrapper
- `dataset-dist/manifest.json` summarizes all generated samples
- package exports are available from `index.js` and `index.d.ts`

The difference is that every generated BGA is partial: selected BGA pads are
intentionally missing. Samples are generated as real `.circuit.tsx` files first;
the missing pads are omitted from the BGA footprint in TSX, then the circuit is
converted through tscircuit circuit JSON into simple-route JSON. Missing pads
are omitted from the SRJ `obstacles` list, and no connection targets an omitted
pad. Each SRJ includes `metadata` with the full grid size, present pad count,
missing pad count, and missing pad ids.

## Generate

```bash
npm run generate
```

This regenerates all 200 TSX-derived samples, `dataset-dist/manifest.json`,
`index.js`, and `index.d.ts` deterministically.

## Manifest Only

```bash
npm run build:dataset-dist
```

This rebuilds the manifest from the existing SRJ files and normalizes BGA pad
`componentId` values to `bga_component`.

## Browse

```bash
npm run start
```

This starts React Cosmos on port 5000 for inspecting the dataset page.

## Test

```bash
npm test
```

The test suite renders selected samples to SVG snapshots and checks that missing
BGA pads are absent from both the generated SRJ pads and connection endpoints.
