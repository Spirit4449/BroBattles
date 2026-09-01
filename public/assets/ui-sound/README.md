# UI Sound System

Simple, efficient sound system for button clicks and UI interactions.

## Quick Start

### Automatic (Recommended)

Just add `data-sound` attribute to any button or element:

```html
<button data-sound="click">Click Me</button>
<button data-sound="ready">Ready</button>
<button data-sound="cancel" data-volume="0.3">Cancel</button>
```

### Manual (Programmatic)

```javascript
import { playSound } from "./lib/uiSounds.js";

// Play a sound
playSound("click"); // Default volume (0.5)
playSound("success", 0.8); // Custom volume
```

### Optional Hover Sounds

```html
<button data-sound="click" data-sound-hover="hover">Button</button>
```

## Sound Files

Place `.mp3` files in `/public/assets/ui-sound/`

Default sounds (edit `soundFiles` in `uiSounds.js` to add more):

- `click.mp3` - General button clicks
- `hover.mp3` - Button hover (optional)
- `ready.mp3` - Ready button
- `cancel.mp3` - Cancel/back actions
- `success.mp3` - Success actions
- `error.mp3` - Error feedback

## Adding New Sounds

1. Add `.mp3` file to `/public/assets/ui-sound/`
2. Edit `src/lib/uiSounds.js` and add to `soundFiles` object:
   ```javascript
   const soundFiles = {
     click: "click",
     newSound: "newSound", // Add this
   };
   ```
3. Use it: `<button data-sound="newSound">Button</button>`

## Volume Control

- Default: 0.5 (click sounds), 0.3 (hover sounds)
- Custom: Add `data-volume="0.7"` to element
- Or pass volume: `playSound('click', 0.7)`

## Notes

- Sounds are preloaded on page load for instant playback
- Failed sounds log to console but don't break the UI
- Uses event delegation for optimal performance

## Shop sound sources

The `shop-open`, `shop-close`, `shop-hover`, `shop-press`, `shop-buy`,
`shop-confirm`, `shop-big-success`, `shop-error`, and `shop-reveal` OGG files
are selected from Kenney's **Interface Sounds 1.0**
pack. Kenney distributes the pack under Creative Commons Zero (CC0):
https://kenney.nl/assets/interface-sounds

`shop-currency-impact.wav` is the stereo **Gem collect SFX** by Bobjt on
OpenGameArt, also released under CC0:
https://opengameart.org/content/gem-collect-sfx

Credit is not required by either license, but the sources are retained here
for provenance.
