import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getSimpleRouteJsonFromCircuitJson } from "@tscircuit/core"
import { runTscircuitCode } from "@tscircuit/eval"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const circuitsDir = path.join(repoRoot, "circuits")
const datasetDistDir = path.join(repoRoot, "dataset-dist")

const sampleCount = 200
const pitch = 0.8
const bgaPadSize = 0.36
const edgePadLong = 0.85
const edgePadShort = 0.5
const bgaPadComponentId = "bga_component"

const padId = (n) => String(n).padStart(3, "0")
const sampleName = (n) => `sample${padId(n)}`
const round = (value) => Number(value.toFixed(3))
const formatMm = (value) => `${round(value)}mm`

function createRng(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function shuffle(items, rng) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function getPadGrid(gridSize) {
  const offset = ((gridSize - 1) * pitch) / 2
  const pads = []

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const number = row * gridSize + col + 1
      pads.push({
        number,
        id: padId(number),
        pinName: `pin${padId(number)}`,
        row,
        col,
        x: round(col * pitch - offset),
        y: round(offset - row * pitch),
      })
    }
  }

  return pads
}

function chooseMissingPads(pads, gridSize, sampleIndex, rng) {
  const pattern = sampleIndex % 8
  const byCoord = new Map(pads.map((pad) => [`${pad.row}:${pad.col}`, pad]))
  const selected = new Set()
  const add = (row, col) => {
    const pad = byCoord.get(`${row}:${col}`)
    if (pad) selected.add(pad.number)
  }

  if (pattern === 0) {
    const row = 1 + Math.floor(rng() * Math.max(1, gridSize - 2))
    for (let col = 1; col < gridSize - 1; col += 2) add(row, col)
  } else if (pattern === 1) {
    const col = 1 + Math.floor(rng() * Math.max(1, gridSize - 2))
    for (let row = 1; row < gridSize - 1; row += 2) add(row, col)
  } else if (pattern === 2) {
    const center = Math.floor(gridSize / 2)
    add(center, center)
    add(center - 1, center)
    add(center, center - 1)
    add(center - 1, center - 1)
  } else if (pattern === 3) {
    for (let i = 1; i < gridSize - 1; i += 2) add(i, i)
  } else if (pattern === 4) {
    for (let i = 1; i < gridSize - 1; i += 2) add(i, gridSize - 1 - i)
  } else if (pattern === 5) {
    const corner = Math.floor(rng() * 4)
    const rowStart = corner < 2 ? 0 : gridSize - 3
    const colStart = corner % 2 === 0 ? 0 : gridSize - 3
    for (let row = rowStart; row < rowStart + 3; row++) {
      for (let col = colStart; col < colStart + 3; col++) add(row, col)
    }
  } else {
    const missingTarget = Math.max(
      3,
      Math.round(pads.length * (0.08 + rng() * 0.14)),
    )
    for (const pad of shuffle(pads, rng)) {
      selected.add(pad.number)
      if (selected.size >= missingTarget) break
    }
  }

  const maxMissing = Math.max(1, Math.floor(pads.length * 0.28))
  return new Set([...selected].slice(0, maxMissing))
}

function getEdgePoint(index, total, boardHalf) {
  const side = index % 4
  const slot = Math.floor(index / 4)
  const slotsPerSide = Math.ceil(total / 4)
  const usable = boardHalf * 1.55
  const start = -usable / 2
  const step = slotsPerSide > 1 ? usable / (slotsPerSide - 1) : 0
  const offset = round(start + slot * step)

  if (side === 0) {
    return {
      x: offset,
      y: round(boardHalf - edgePadShort / 2),
      width: edgePadLong,
      height: edgePadShort,
      rotation: 0,
    }
  }
  if (side === 1) {
    return {
      x: round(boardHalf - edgePadShort / 2),
      y: offset,
      width: edgePadShort,
      height: edgePadLong,
      rotation: 0,
    }
  }
  if (side === 2) {
    return {
      x: offset,
      y: round(-boardHalf + edgePadShort / 2),
      width: edgePadLong,
      height: edgePadShort,
      rotation: 0,
    }
  }
  return {
    x: round(-boardHalf + edgePadShort / 2),
    y: offset,
    width: edgePadShort,
    height: edgePadLong,
    rotation: 0,
  }
}

function createSampleSpec(sampleIndex) {
  const rng = createRng(0x5eed0000 + sampleIndex * 9973)
  const gridSize = 6 + ((sampleIndex - 1) % 8)
  const pads = getPadGrid(gridSize)
  const missingPadNumbers = chooseMissingPads(pads, gridSize, sampleIndex, rng)
  const presentPads = pads.filter((pad) => !missingPadNumbers.has(pad.number))
  const connectionTarget = Math.min(
    presentPads.length,
    Math.max(
      8,
      Math.round(presentPads.length * (0.32 + rng() * 0.36)),
    ),
  )
  const connectedPads = shuffle(presentPads, rng).slice(0, connectionTarget)
  const boardHalf = round(
    Math.max(5.38, ((gridSize - 1) * pitch) / 2 + 3.15 + connectionTarget * 0.035),
  )

  return {
    gridSize,
    pads,
    presentPads,
    connectedPads,
    edgePoints: connectedPads.map((_, index) =>
      getEdgePoint(index, connectionTarget, boardHalf),
    ),
    boardHalf,
    bgaLayer: sampleIndex % 2 === 0 ? "top" : "bottom",
    missingBgaPads: [...missingPadNumbers]
      .sort((a, b) => a - b)
      .map((number) => `bga_pin_${padId(number)}`),
  }
}

function getBgaPinLabelsTsx(pads) {
  return `{${pads
    .map((pad) => `${pad.pinName}: "${pad.pinName}"`)
    .join(", ")}}`
}

function getBgaPadTsx(pad, layer) {
  return `        <smtpad
          portHints={["${pad.pinName}"]}
          pcbX="${formatMm(pad.x)}"
          pcbY="${formatMm(pad.y)}"
          width="${formatMm(bgaPadSize)}"
          height="${formatMm(bgaPadSize)}"
          shape="rect"
          layer="${layer}"
        />`
}

function getIoTestpointTsx(edgePoint, ioIndex, layer) {
  const ioNumber = padId(ioIndex + 1)
  return `      <testpoint
        name="TP${ioNumber}"
        footprintVariant="pad"
        padShape="rect"
        pcbX="${formatMm(edgePoint.x)}"
        pcbY="${formatMm(edgePoint.y)}"
        width="${formatMm(edgePoint.width)}"
        height="${formatMm(edgePoint.height)}"
        layer="${layer}"
        pcbPositionMode="relative_to_board_anchor"
      />`
}

function createCircuitTsx(spec) {
  return `export default () => (
  <board width="${formatMm(spec.boardHalf * 2)}" height="${formatMm(spec.boardHalf * 2)}" routingDisabled schematicDisabled>
    <chip
      name="BGA"
      pcbX="0mm"
      pcbY="0mm"
      layer="${spec.bgaLayer}"
      pinLabels={${getBgaPinLabelsTsx(spec.presentPads)}}
      footprint={
        <footprint>
${spec.presentPads.map((pad) => getBgaPadTsx(pad, spec.bgaLayer)).join("\n")}
        </footprint>
      }
    />
${spec.edgePoints
  .map((edgePoint, index) => getIoTestpointTsx(edgePoint, index, spec.bgaLayer))
  .join("\n")}
${spec.connectedPads
  .map(
    (pad, index) =>
      `      <trace from=".BGA > .${pad.pinName}" to=".TP${padId(index + 1)} > .pin1" />`,
  )
  .join("\n")}
  </board>
)
`
}

const getMapById = (circuitJson, type, idKey) =>
  new Map(
    circuitJson
      .filter((element) => element.type === type)
      .map((element) => [element[idKey], element]),
  )

const getPcbSmtpadIdFromObstacle = (obstacle) =>
  obstacle.connectedTo?.find((connection) => connection.startsWith("pcb_smtpad_"))

const padHintToPaddedNumber = (pad) => {
  const hint = pad?.port_hints?.find((value) => /^pin\d+$/.test(value))
  const number = hint?.replace(/^pin/, "") ?? String(pad?.pin_number ?? 0)
  return number.padStart(3, "0")
}

function getComponentInfoForPcbPort({
  pcbPortId,
  pcbPortById,
  sourcePortById,
  sourceComponentById,
}) {
  const pcbPort = pcbPortById.get(pcbPortId)
  const sourcePort = sourcePortById.get(pcbPort?.source_port_id)
  const sourceComponent = sourceComponentById.get(sourcePort?.source_component_id)

  return { pcbPort, sourcePort, sourceComponent }
}

function normalizeSrjFromCircuitJson({
  circuitJson,
  simpleRouteJson,
  sampleName,
  spec,
}) {
  const pcbSmtpadById = getMapById(circuitJson, "pcb_smtpad", "pcb_smtpad_id")
  const pcbPortById = getMapById(circuitJson, "pcb_port", "pcb_port_id")
  const pcbComponentById = getMapById(
    circuitJson,
    "pcb_component",
    "pcb_component_id",
  )
  const sourcePortById = getMapById(
    circuitJson,
    "source_port",
    "source_port_id",
  )
  const sourceComponentById = getMapById(
    circuitJson,
    "source_component",
    "source_component_id",
  )

  for (const obstacle of simpleRouteJson.obstacles ?? []) {
    const pcbSmtpad = pcbSmtpadById.get(getPcbSmtpadIdFromObstacle(obstacle))
    const pcbComponent = pcbComponentById.get(pcbSmtpad?.pcb_component_id)
    const sourceComponent = sourceComponentById.get(
      pcbComponent?.source_component_id,
    )
    const sourcePort = sourcePortById.get(
      pcbPortById.get(pcbSmtpad?.pcb_port_id)?.source_port_id,
    )
    const sourceComponentName = sourceComponent?.name ?? "component"

    obstacle.connectedTo = Array.isArray(obstacle.connectedTo)
      ? obstacle.connectedTo
      : []

    if (sourceComponentName === "BGA") {
      const pinNumber = padHintToPaddedNumber(sourcePort)
      obstacle.obstacleId = `pcb_smtpad_bga_pin_${pinNumber}`
      obstacle.componentId = bgaPadComponentId
      obstacle.layers = [spec.bgaLayer]
      obstacle.connectedTo = [
        `bga_pin_${pinNumber}`,
        `pcb_port_bga_pin_${pinNumber}`,
        `bga_net_${pinNumber}`,
      ]
      continue
    }

    if (sourceComponentName.startsWith("TP")) {
      const ioNumber = sourceComponentName.replace(/^TP/, "").padStart(3, "0")
      const netNumber = spec.connectedPads[Number(ioNumber) - 1]?.id ?? ioNumber
      obstacle.obstacleId = `pcb_smtpad_io_pin_${ioNumber}`
      obstacle.componentId = sourceComponentName
      obstacle.layers = [spec.bgaLayer]
      obstacle.connectedTo = [
        `io_pin_${ioNumber}`,
        `pcb_port_io_pin_${ioNumber}`,
        `bga_net_${netNumber}`,
      ]
    }
  }

  for (const [connectionIndex, connection] of (
    simpleRouteJson.connections ?? []
  ).entries()) {
    const connectionNumber = padId(connectionIndex + 1)
    const connectedBgaPad = spec.connectedPads[connectionIndex]

    connection.name = `bga_conn_${connectionNumber}`
    connection.rootConnectionName = connection.name

    for (const point of connection.pointsToConnect ?? []) {
      const { sourcePort, sourceComponent } = getComponentInfoForPcbPort({
        pcbPortId: point.pcb_port_id,
        pcbPortById,
        sourcePortById,
        sourceComponentById,
      })

      if (sourceComponent?.name === "BGA") {
        const pinNumber = padHintToPaddedNumber(sourcePort)
        point.layer = spec.bgaLayer
        point.pointId = `bga_pin_${pinNumber}`
        point.pcb_port_id = `pcb_port_bga_pin_${pinNumber}`
      } else if (sourceComponent?.name?.startsWith("TP")) {
        const ioNumber = sourceComponent.name.replace(/^TP/, "").padStart(3, "0")
        point.layer = spec.bgaLayer
        point.pointId = `io_pin_${ioNumber}`
        point.pcb_port_id = `pcb_port_io_pin_${ioNumber}`
      }
    }

    connection.connectedNet = connectedBgaPad
      ? `bga_net_${connectedBgaPad.id}`
      : undefined
  }

  simpleRouteJson.metadata = {
    ...(simpleRouteJson.metadata ?? {}),
    sampleName,
    gridSize: spec.gridSize,
    pitch,
    bgaPadSize,
    bgaLayer: spec.bgaLayer,
    fullBgaPadCount: spec.pads.length,
    presentBgaPadCount: spec.presentPads.length,
    missingBgaPadCount: spec.missingBgaPads.length,
    missingBgaPads: spec.missingBgaPads,
    generatedFrom: "tsx-circuit-json-core-simple-route",
    partialBgaRule:
      "Partial BGA samples are generated as real TSX circuits. Missing pads are omitted from the BGA footprint before tscircuit renders circuit JSON, then @tscircuit/core converts the circuit JSON to simple-route JSON.",
  }

  return simpleRouteJson
}

async function getSimpleRouteJsonFromTsx({ circuitTsx, sampleName, spec }) {
  const circuitJson = await runTscircuitCode(circuitTsx, { name: sampleName })
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({
    circuitJson,
    minTraceWidth: 0.12,
    nominalTraceWidth: 0.12,
  })

  return normalizeSrjFromCircuitJson({
    circuitJson,
    simpleRouteJson,
    sampleName,
    spec,
  })
}

async function writeSample(sampleIndex) {
  const name = sampleName(sampleIndex)
  const spec = createSampleSpec(sampleIndex)
  const circuitTsx = createCircuitTsx(spec)
  const srj = await getSimpleRouteJsonFromTsx({
    circuitTsx,
    sampleName: name,
    spec,
  })
  const sampleDir = path.join(circuitsDir, name)

  await mkdir(sampleDir, { recursive: true })
  await writeFile(path.join(sampleDir, `${name}.circuit.tsx`), circuitTsx)
  await writeFile(
    path.join(sampleDir, `${name}.circuit.simple-route.json`),
    `${JSON.stringify(srj, null, 2)}\n`,
  )

  return {
    sampleName: name,
    sourceFile: `circuits/${name}/${name}.circuit.simple-route.json`,
    connectionCount: srj.connections?.length ?? 0,
    obstacleCount: srj.obstacles?.length ?? 0,
    fullBgaPadCount: srj.metadata.fullBgaPadCount,
    presentBgaPadCount: srj.metadata.presentBgaPadCount,
    missingBgaPadCount: srj.metadata.missingBgaPadCount,
    missingBgaPads: srj.metadata.missingBgaPads,
    bgaLayer: srj.metadata.bgaLayer,
    bounds: srj.bounds,
  }
}

async function writePackageExports() {
  const names = Array.from({ length: sampleCount }, (_, index) =>
    sampleName(index + 1),
  )
  const js = [
    ...names.map(
      (name) =>
        `const ${name}Srj = require("./circuits/${name}/${name}.circuit.simple-route.json")`,
    ),
    "",
    "module.exports = {",
    ...names.map((name) => `  ${name}Srj,`),
    "}",
    "",
  ].join("\n")
  const dts = [
    "type JsonValue =",
    "  | string",
    "  | number",
    "  | boolean",
    "  | null",
    "  | JsonValue[]",
    "  | { [key: string]: JsonValue }",
    "",
    ...names.map((name) => `export const ${name}Srj: JsonValue`),
    "",
  ].join("\n")

  await writeFile(path.join(repoRoot, "index.js"), js)
  await writeFile(path.join(repoRoot, "index.d.ts"), dts)
}

await rm(circuitsDir, { recursive: true, force: true })
await rm(datasetDistDir, { recursive: true, force: true })
await mkdir(circuitsDir, { recursive: true })
await mkdir(datasetDistDir, { recursive: true })

const samples = []
for (let i = 1; i <= sampleCount; i++) {
  samples.push(await writeSample(i))
  if (i % 25 === 0 || i === sampleCount) {
    console.log(`Generated ${i}/${sampleCount} TSX-derived samples...`)
  }
}

await writeFile(
  path.join(datasetDistDir, "manifest.json"),
  `${JSON.stringify(
    {
      datasetName: "dataset-srj20-partial-bga-breakouts",
      sampleCount: samples.length,
      rule: "Every connection has exactly one endpoint on a present pad in a TSX-generated partial BGA footprint. Missing BGA pads are omitted before conversion to simple-route JSON. IO fanout pads are placed on board edges.",
      samples,
    },
    null,
    2,
  )}\n`,
)

await writePackageExports()
