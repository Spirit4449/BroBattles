// src/client/game/characters/manifest.js
// Central character registry. To add a new character:
//   1. Create src/client/game/characters/{name}/ with constructor.js, anim.js, attack.js, special.js
//   2. Add one import + one entry to the array below.
import Ninja from "./ninja/constructor";
import Thorg from "./thorg/constructor";
import Draven from "./draven/constructor";
import Ozzy from "./ozzy/constructor";
import Sparrow from "./sparrow/constructor";
import Gloop from "./gloop/constructor";

/** @type {import("./shared/characterEntityBase").default[]} */
const CHARACTER_MANIFEST = [Ninja, Thorg, Draven, Ozzy, Sparrow, Gloop];

export default CHARACTER_MANIFEST;
