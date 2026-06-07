import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { readFileSync } from "node:fs"
import path from "node:path"

const sampleNames = [
  "sample001",
  "sample014",
  "sample027",
  "sample052",
  "sample079",
  "sample103",
  "sample126",
  "sample151",
  "sample178",
  "sample200",
]

const getSampleSrj = (sampleName) =>
  JSON.parse(
    readFileSync(
      path.join(
        import.meta.dirname,
        "..",
        "circuits",
        sampleName,
        `${sampleName}.circuit.simple-route.json`,
      ),
      "utf8",
    ),
  )

const getBgaPads = (srj) =>
  srj.obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("pcb_smtpad_bga_pin_"),
  )

const getIoPads = (srj) =>
  srj.obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("pcb_smtpad_io_pin_"),
  )

const getConnectionPoints = (srj) =>
  srj.connections.flatMap((connection) => connection.pointsToConnect)

const getMissingPadRects = (srj) => {
  const gridSize = srj.metadata.gridSize
  const pitch = srj.metadata.pitch
  const padSize = srj.metadata.bgaPadSize
  const offset = ((gridSize - 1) * pitch) / 2

  return srj.metadata.missingBgaPads.map((pinId) => {
    const number = Number(pinId.replace(/^bga_pin_/, ""))
    const row = Math.floor((number - 1) / gridSize)
    const col = (number - 1) % gridSize

    return {
      center: {
        x: Number((col * pitch - offset).toFixed(3)),
        y: Number((offset - row * pitch).toFixed(3)),
      },
      width: padSize,
      height: padSize,
      fill: "rgba(255,255,255,0)",
      stroke: "#dc2626",
      label: "MISSING",
    }
  })
}

const getObstacleStyle = (obstacle) => {
  if (obstacle.obstacleId?.startsWith("pcb_smtpad_bga_pin_")) {
    return {
      fill: "rgba(37, 99, 235, 0.62)",
      stroke: "#1d4ed8",
      label: "BGA",
    }
  }

  return {
    fill: "rgba(20, 184, 166, 0.55)",
    stroke: "#0f766e",
    label: "IO",
  }
}

const createSampleGraphics = (srj) => {
  const boardCenter = {
    x: (srj.bounds.minX + srj.bounds.maxX) / 2,
    y: (srj.bounds.minY + srj.bounds.maxY) / 2,
  }

  return {
    rects: [
      {
        center: boardCenter,
        width: srj.bounds.maxX - srj.bounds.minX,
        height: srj.bounds.maxY - srj.bounds.minY,
        fill: "rgba(255,255,255,0)",
        stroke: "#64748b",
        label: "board",
      },
      ...srj.obstacles.map((obstacle) => ({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        ccwRotationDegrees: obstacle.ccwRotationDegrees,
        ...getObstacleStyle(obstacle),
      })),
      ...getMissingPadRects(srj),
    ],
    texts: [
      {
        x: boardCenter.x,
        y: srj.bounds.maxY + (srj.bounds.maxY - srj.bounds.minY) * 0.08,
        text: `Partial BGA ${srj.metadata.bgaLayer}: ${srj.metadata.missingBgaPadCount} missing pads`,
        anchorSide: "bottom_center",
        color: "#334155",
        fontSize: (srj.bounds.maxX - srj.bounds.minX) * 0.045,
      },
    ],
  }
}

test("partial bga random samples render to individual svg snapshots", () => {
  for (const sampleName of sampleNames) {
    const srj = getSampleSrj(sampleName)
    const svg = getSvgFromGraphicsObject(createSampleGraphics(srj), {
      backgroundColor: "white",
      includeTextLabels: false,
      svgWidth: 480,
      svgHeight: 480,
    })

    expect(svg).toMatchSvgSnapshot(import.meta.path, sampleName)
  }
})

test("partial bga random samples stay router-compatible", () => {
  for (const sampleName of sampleNames) {
    const srj = getSampleSrj(sampleName)
    const bgaPads = getBgaPads(srj)
    const ioPads = getIoPads(srj)
    const connectionPoints = getConnectionPoints(srj)
    const presentBgaPinIds = new Set(
      bgaPads.map((obstacle) => obstacle.connectedTo?.[0]),
    )

    expect(bgaPads.length).toBe(srj.metadata.presentBgaPadCount)
    expect(ioPads.length).toBe(srj.connections.length)
    expect(srj.metadata.missingBgaPadCount).toBeGreaterThan(0)
    expect(srj.metadata.fullBgaPadCount).toBe(
      srj.metadata.presentBgaPadCount + srj.metadata.missingBgaPadCount,
    )

    for (const missingPad of srj.metadata.missingBgaPads) {
      expect(presentBgaPinIds.has(missingPad)).toBe(false)
    }

    for (const connection of srj.connections) {
      const bgaPoint = connection.pointsToConnect.find((point) =>
        point.pointId?.startsWith("bga_pin_"),
      )
      const ioPoint = connection.pointsToConnect.find((point) =>
        point.pointId?.startsWith("io_pin_"),
      )

      expect(bgaPoint).toBeTruthy()
      expect(ioPoint).toBeTruthy()
      expect(presentBgaPinIds.has(bgaPoint.pointId)).toBe(true)
    }

    for (const point of connectionPoints) {
      expect(srj.metadata.missingBgaPads.includes(point.pointId)).toBe(false)
    }
  }
})
