// Register each character entity here. See shared/characterEntityBase.js for
// supported hooks and docs/development/contributing.md for the full checklist.
import Ninja from "./ninja/constructor";
import Thorg from "./thorg/constructor";
import Draven from "./draven/constructor";
import Ozzy from "./ozzy/constructor";
import Sparrow from "./sparrow/constructor";
import Gloop from "./gloop/constructor";

/** @type {import("./shared/characterEntityBase").default[]} */
const CHARACTER_MANIFEST = [Ninja, Thorg, Draven, Ozzy, Sparrow, Gloop];

export default CHARACTER_MANIFEST;
