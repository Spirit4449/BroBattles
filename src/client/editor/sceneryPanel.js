import { pixelArrow } from "../ui/pixelArrow.js";
import { ARENA_DEPTH, CLOUD_TYPES, RANDOM_CLOUD } from "../../shared/maps/scenery";
import { editor, friendlyName, map, uid } from "./studioState";
import { node, showDialog, advanced, section, field, check, button } from "./studioControls";
import { transaction } from "./mapSession";
import { editValue, recursiveFields } from "./inspector";
import { addObject } from "./objectEdits";

// Scenery: art layers back to front, the map's clouds and its atmosphere.
const FIT_LABELS = [
  ["cover", "Fill the screen"],
  ["cover-x", "Fill the width"],
  ["none", "Natural size"],
];

const STACK_LABELS = [
  ["back", "Behind platforms"],
  ["arena", "Over platforms, under fighters"],
  ["front", "Over fighters"],
];

function renderScenery(panel) {
  const scenery = map().scenery;
  panel.append(
    node("h3", "Scenery"),
    node(
      "p",
      "Layers draw back to front. Press Game camera (C) to see parallax, fog and the zoom range as players will.",
    ),
  );
  const layers = section("Layers");
  panel.append(layers);
  scenery.layers.forEach((layer, i) => {
    const card = node("div", undefined, { class: "layer-card" });
    layers.append(card);
    const head = node("div", undefined, { class: "layer-head" });
    head.append(node("strong", `${i + 1}. ${friendlyName(layer.id)}`));
    card.append(head);
    const move = (offset) =>
      transaction(() => {
        const list = scenery.layers;
        const [item] = list.splice(i, 1);
        list.splice(i + offset, 0, item);
      }, "Layer moved");
    const up = button(head, "", () => move(-1));
    up.append(pixelArrow("up", "sm"));
    up.setAttribute("aria-label", "Draw further back");
    up.disabled = i === 0;
    up.title = "Draw further back";
    const down = button(head, "", () => move(1));
    down.append(pixelArrow("down", "sm"));
    down.setAttribute("aria-label", "Draw nearer");
    down.disabled = i === scenery.layers.length - 1;
    down.title = "Draw nearer";
    const del = button(
      head,
      "✕",
      () =>
        transaction(() => {
          scenery.layers.splice(i, 1);
        }, "Layer removed"),
      "danger",
    );
    del.title = "Remove layer";
    del.disabled = scenery.layers.length === 1;
    card.append(node("img", undefined, { src: layer.url, alt: "", class: "layer-thumb" }));
    const grid = node("div", undefined, { class: "fields" });
    card.append(grid);
    field(grid, "Parallax", layer.scroll, (v) => editValue(layer, "scroll", v), {
      min: 0,
      max: 3,
      step: 0.01,
    });
    field(
      grid,
      "Fog (%)",
      Math.round((layer.fog ?? 0) * 100),
      (v) =>
        transaction(() => {
          if (v > 0) layer.fog = v / 100;
          else delete layer.fog;
        }),
      { min: 0, max: 100 },
    );
    field(grid, "X offset", layer.x ?? 0, (v) => editValue(layer, "x", v));
    field(grid, "Y offset", layer.y ?? 0, (v) => editValue(layer, "y", v));
    field(grid, "Scale", layer.scale ?? 1, (v) => editValue(layer, "scale", v), {
      min: 0.01,
      step: 0.01,
    });
    field(
      grid,
      "Opacity (%)",
      Math.round((layer.alpha ?? 1) * 100),
      (v) => editValue(layer, "alpha", v / 100),
      { min: 0, max: 100 },
    );
    field(card, "Size", layer.fit || "cover", (v) => editValue(layer, "fit", v), {
      options: FIT_LABELS,
    });
    field(
      card,
      "Draw",
      layer.stack || (layer.scroll > 1 ? "front" : "back"),
      (v) => editValue(layer, "stack", v),
      { options: STACK_LABELS },
    );
    const more = advanced(card);
    field(
      more,
      "Image URL",
      layer.url,
      (v) =>
        transaction(() => {
          layer.url = v;
        }, "Layer image changed"),
      { full: true },
    );
    field(
      more,
      "Baked blur (px)",
      layer.blur ?? 0,
      (v) =>
        transaction(() => {
          if (v > 0) layer.blur = v;
          else delete layer.blur;
        }),
      { min: 0, max: 16, step: 0.5 },
    );
    more.append(
      node(
        "div",
        "Blur is written into the image by the art importer (node scripts/art/import-map-art.cjs). Re-run it after changing blur.",
        { class: "muted" },
      ),
    );
  });
  button(layers, "＋ Add layer", addLayerDialog);
  const clouds = section("Clouds");
  panel.append(clouds);
  check(clouds, "Show clouds", !!scenery.clouds?.enabled, (v) =>
    transaction(
      () => {
        scenery.clouds = { enabled: v, items: scenery.clouds?.items || [] };
      },
      v ? "Clouds on" : "Clouds off",
    ),
  );
  clouds.append(
    node(
      "p",
      `${scenery.clouds?.items?.length || 0} clouds. Add one here or from the object list, then drag it on the map.`,
      { class: "muted" },
    ),
  );
  button(clouds, "＋ Add cloud", () => addObject("cloud"));
  const atmosphere = section("Atmosphere");
  panel.append(atmosphere);
  atmosphere.append(
    node(
      "p",
      "Fog colour, mist, light rays, glows, dust, platform lighting and vignette. Shown on High and Super High graphics.",
      { class: "muted" },
    ),
  );
  if (!scenery.atmosphere) {
    button(atmosphere, "＋ Add atmosphere", () =>
      transaction(() => {
        scenery.atmosphere = { fogColor: "#ffffff", vignette: { color: "#000000", alpha: 0.2 } };
      }, "Atmosphere added"),
    );
    return;
  }
  recursiveFields(atmosphere, scenery.atmosphere);
  button(
    atmosphere,
    "Remove atmosphere",
    () =>
      transaction(() => {
        delete scenery.atmosphere;
      }, "Atmosphere removed"),
    "danger",
  );
}

function addLayerDialog() {
  if (editor.busy) return;
  const values = { id: uid("layer"), url: "/assets/", scroll: 0.5 };
  const content = node("div");
  content.append(
    node(
      "p",
      "A layer is one image of the backdrop. Parallax 0 stays put, 1 moves with the platforms, above 1 is foreground.",
    ),
  );
  field(content, "Image URL", values.url, (v) => (values.url = v), { full: true });
  field(content, "Parallax", values.scroll, (v) => (values.scroll = v), {
    min: 0,
    max: 3,
    step: 0.01,
  });
  showDialog(
    "Add scenery layer",
    content,
    () =>
      transaction(() => {
        map().scenery.layers.push({ id: values.id, url: values.url, scroll: values.scroll });
      }, "Layer added"),
    "Add layer",
  );
}

function renderCloudInspector(panel, cloud) {
  const picker = node("div", undefined, { class: "cloud-picker" });
  panel.append(node("div", "Cloud", { class: "section-title" }), picker);
  const pick = (type, content) => {
    const b = node("button", undefined, {
      type: "button",
      class: cloud.type === type ? "active" : "",
      title: type === RANDOM_CLOUD ? "Random cloud" : friendlyName(type),
    });
    if (typeof content === "string") b.textContent = content;
    else b.append(content);
    b.onclick = () =>
      transaction(() => {
        cloud.type = type;
      }, "Cloud changed");
    picker.append(b);
  };
  pick(RANDOM_CLOUD, "Random");
  for (const [type, url] of Object.entries(CLOUD_TYPES))
    pick(type, node("img", undefined, { src: url, alt: "" }));
  const grid = node("div", undefined, { class: "fields" });
  panel.append(grid);
  for (const k of ["x", "y"]) field(grid, k.toUpperCase(), cloud[k], (v) => editValue(cloud, k, v));
  field(grid, "Drift", cloud.direction, (v) => editValue(cloud, "direction", v), {
    options: [
      ["right", "Right"],
      ["left", "Left"],
    ],
  });
  field(grid, "Speed (px/sec)", cloud.speed, (v) => editValue(cloud, "speed", v), {
    min: 0,
    max: 500,
  });
  field(grid, "Scale", cloud.scale ?? 1, (v) => editValue(cloud, "scale", v), {
    min: 0.01,
    step: 0.05,
  });
  field(
    grid,
    "Opacity (%)",
    Math.round((cloud.alpha ?? 1) * 100),
    (v) => editValue(cloud, "alpha", v / 100),
    { min: 0, max: 100 },
  );
  const depth = cloud.front ? "front" : cloud.after || ARENA_DEPTH;
  field(
    panel,
    "Draw",
    depth,
    (v) =>
      transaction(() => {
        delete cloud.front;
        delete cloud.after;
        if (v === "front") cloud.front = true;
        else if (v !== ARENA_DEPTH) cloud.after = v;
      }, "Cloud depth changed"),
    {
      options: [
        [ARENA_DEPTH, "Over platforms, under fighters"],
        ["front", "Over fighters"],
        ...map().scenery.layers.map((l) => [l.id, `In front of ${friendlyName(l.id)}`]),
      ],
    },
  );
  check(panel, "Flip horizontally", !!cloud.flipX, (v) => editValue(cloud, "flipX", v));
  if (!map().scenery.clouds.enabled)
    panel.append(
      node("div", "Clouds are turned off for this map (Scenery tab).", { class: "notice" }),
    );
}

export { renderScenery, renderCloudInspector };
