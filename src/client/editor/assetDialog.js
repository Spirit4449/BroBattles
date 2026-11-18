import { API_PATHS } from "../../shared/net/apiPaths.js";
import { clone, validateDocument, validateMap } from "../../shared/maps/mapDocument";
import { replaceAssetReferences } from "./editorModel";
import { editor, map, uid, setBusy } from "./studioState";
import { request, commit, syncHistoryScene } from "./mapSession";
import { error, node, showDialog, advanced, field } from "./studioControls";
import { addObject } from "./objectEdits";

async function uploadArtwork(file, targetUrl) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error("Unable to read image"));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
  return request(API_PATHS.API_ADMIN_MAPS_UPLOAD, {
    method: "POST",
    body: JSON.stringify({ targetUrl, fileName: file.name, base64 }),
  });
}

async function replaceArtwork(key, file) {
  if (!file || editor.busy) return;
  const before = clone(editor.documentData);
  setBusy(true);
  try {
    const original = map().assets[key],
      target = original.sourceUrl || original.replaceTarget || original.url;
    const upload = await uploadArtwork(file, target);
    replaceAssetReferences(editor.documentData, original, upload);
    const errors = validateDocument(editor.documentData);
    if (errors.length) throw Error(errors.slice(0, 5).join("\n"));
    commit(
      "Artwork replaced in every matching platform. Save writes the image into the game files.",
    );
    await syncHistoryScene();
  } catch (e) {
    editor.documentData = before;
    error(e);
  } finally {
    setBusy(false);
  }
}

function assetDialog(key = null) {
  if (editor.busy) return;
  const current = map().assets[key];
  const values = {
    key: key || uid("platform"),
    type: current?.type || "image",
    url: current?.url || "/assets/maps/platform.png",
    atlasURL: current?.atlasURL || "",
    width: map().textureSizes[key]?.width || 64,
    height: map().textureSizes[key]?.height || 64,
    frames: current?.animation?.frames?.join(",") || "",
    fps: current?.animation?.frameRate || 12,
  };
  const content = node("div");
  function form() {
    content.replaceChildren();
    field(
      content,
      "Artwork",
      values.type === "image" ? "image" : "animated",
      (v) => {
        values.type = v === "image" ? "image" : "spritesheet";
        form();
      },
      {
        options: [
          ["image", "Still image"],
          ["animated", "Animated platform"],
        ],
      },
    );
    field(
      content,
      values.type === "image" ? "Image URL" : "Sprite image URL",
      values.url,
      (v) => (values.url = v),
    );
    if (values.type !== "image") {
      const explained = node(
        "p",
        "An animation uses one image containing many frames. If your export includes a JSON file describing those frames, choose “Image + JSON”.",
      );
      content.append(explained);
      field(
        content,
        "Animation files",
        values.type,
        (v) => {
          values.type = v;
          form();
        },
        {
          options: [
            ["spritesheet", "One image, equal-sized frames"],
            ["atlas", "Image + JSON frame file"],
          ],
        },
      );
      if (values.type === "atlas")
        field(content, "Frame JSON URL", values.atlasURL, (v) => (values.atlasURL = v));
      for (const k of ["width", "height"])
        field(content, `Each frame ${k} (px)`, values[k], (v) => (values[k] = v), { min: 1 });
      field(
        content,
        values.type === "atlas"
          ? "Frame names (comma separated)"
          : "Frame numbers (comma separated)",
        values.frames,
        (v) => (values.frames = v),
      );
      field(content, "Animation speed (frames/sec)", values.fps, (v) => (values.fps = v), {
        min: 1,
        max: 120,
      });
    }
    const more = advanced(content, "Advanced");
    field(more, "Reference key", values.key, (v) => (values.key = v), { disabled: !!key });
    content.append(
      node(
        "p",
        key
          ? "Changing this artwork updates platforms that use it."
          : "This registers the artwork and places a platform on your map.",
      ),
    );
  }
  form();
  showDialog(
    key ? "Change platform artwork" : "Add platform from artwork",
    content,
    async () => {
      const before = clone(editor.documentData);
      const asset = { type: values.type, url: values.url };
      if (values.type === "image") {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(Error("Unable to load that image URL"));
          img.src = values.url;
        });
        values.width = img.naturalWidth;
        values.height = img.naturalHeight;
      }
      if (values.type === "atlas") asset.atlasURL = values.atlasURL;
      if (values.type === "spritesheet")
        asset.frameConfig = { frameWidth: values.width, frameHeight: values.height };
      if (values.type !== "image") {
        if (!values.frames.trim()) throw Error("Enter the animation frames to play.");
        asset.animation = {
          frames: values.frames
            .split(",")
            .map((f) => (values.type === "spritesheet" ? Number(f.trim()) : f.trim())),
          frameRate: values.fps,
          repeat: -1,
        };
      }
      if (!key && map().assets[values.key]) throw Error("That reference key already exists.");
      const old = map().textureSizes[values.key];
      if (old)
        for (const p of map().layout.platforms.filter((p) => p.textureKey === values.key)) {
          p.scaleX *= old.width / values.width;
          p.scaleY *= old.height / values.height;
          if (p.body) {
            p.body.offsetX = ((p.body.offsetX || 0) * values.width) / old.width;
            p.body.offsetY = ((p.body.offsetY || 0) * values.height) / old.height;
          }
        }
      map().assets[values.key] = asset;
      map().textureSizes[values.key] = { width: values.width, height: values.height };
      const errors = validateMap(map());
      if (errors.length) {
        editor.documentData = before;
        throw Error(errors.join("\n"));
      }
      commit("Platform artwork updated");
      await syncHistoryScene();
      if (!key) addObject("platform", values.key);
    },
    key ? "Update platforms" : "Add platform",
  );
}

export { replaceArtwork, assetDialog };
