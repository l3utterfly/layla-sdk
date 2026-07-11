# VRM Avatar Background

A React + Vite app that renders a single VRM avatar as a non-interactive
background layer. No controls, no UI — the camera is fixed and the avatar plays
through a list of VRMA animations on its own. Everything is configured from one
`settings.json` file, so you can re-frame the character or swap animations
without touching code.

## Setup

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Blending & interrupting animations

Each `.vrma` becomes a standard Three.js `AnimationClip` on one `AnimationMixer`,
so transitions are just weighted cross-fades — one clip fades out while the next
fades in, and starting a fade at any moment interrupts what's playing. Beyond the
automatic cycling, you can drive this from `window.avatar`:

```js
avatar.getAnimations();                 // list loaded clips (paths) to target

// Interrupt and cross-fade to a clip, then hold it (loops by default)
avatar.play("idle", { fade: 0.4 });

// Play a gesture once, then flow back to what it interrupted
avatar.playOnce("wave");                // returns to the auto sequence / idle
avatar.playOnce("point", { returnTo: "idle", fade: 0.25 });

avatar.resumeAuto();                     // hand control back to auto-cycling
avatar.stop({ fade: 0.5 });             // ease to rest
avatar.setSpeed(1.5);                    // speed up the current clip
```

Targets can be an index, a full path (`/models/wave.vrma`), or a basename
(`wave`). `fade` is the cross-fade time in seconds — smaller for snappy
interrupts, larger for languid transitions. Because fades overlap, a short fade
still reads as a smooth interruption rather than a hard cut.

> Want a gesture *layered on top of* an idle (e.g. waving while still breathing)
> rather than replacing it? That's additive blending
> (`THREE.AnimationUtils.makeClipAdditive`), which the mixer also supports — ask
> and I can wire it in.

## Driving the face (blinking, talking, expressions)

The avatar blinks on its own automatically. For everything else, the running
engine is exposed as `window.avatar`, so you can drive eyes and mouth from your
own code or the browser console. All weights are `0..1`.

```js
// Eyes
avatar.setAutoBlink(false);      // take over blinking yourself
avatar.blink();                  // trigger one blink
avatar.setExpression("blink", 1) // hold eyes closed
avatar.clearExpression("blink"); // release

// Mouth / talking
avatar.setMouthOpen(0.6);        // amplitude-style lip sync (drives the "aa" viseme)
avatar.setViseme("oh");          // a specific vowel shape: aa | ih | ou | ee | oh
avatar.closeMouth();

// Emotions and anything else (any VRM expression preset)
avatar.setExpressions({ happy: 1, aa: 0.2 });
avatar.setExpression("surprised", 1);
```

For simple lip sync, feed `setMouthOpen()` your audio's normalized volume once
per frame (e.g. from a Web Audio `AnalyserNode`). For phoneme-accurate talking,
call `setViseme()` with the vowel for each sound. Anything you set here is
re-applied every frame and overrides the current animation until you clear it.

Available presets depend on the model, but the standard ones are: `blink`,
`blinkLeft`, `blinkRight`, the visemes `aa` / `ih` / `ou` / `ee` / `oh`, and the
emotions `happy` / `angry` / `sad` / `relaxed` / `surprised` / `neutral`.
Setting a preset the model doesn't define is a safe no-op.

## Add your files

Drop your avatar and animations into `public/models/`, then point
`public/settings.json` at them. Out of the box it expects:

```
public/models/avatar.vrm
public/models/idle.vrma
public/models/gesture.vrma
```

You can grab free VRM models and VRMA animations from VRoid Hub and booth.pm.
Any `.vrma` retargets automatically onto your model via its humanoid bones.

## Configuration — `public/settings.json`

This file is served from the site root as `/settings.json`. It's read at
runtime, so after `npm run build` you can still edit it inside `dist/` and just
refresh the page.

| Key | Description |
| --- | --- |
| `model` | Path to the `.vrm` file (required). |
| `animations` | Array of `.vrma` paths. Loaded in order and cycled through. |
| `animation.mode` | `"sequence"` (in order), `"random"`, or `"single"` (loop the first only). |
| `animation.crossFadeDuration` | Seconds to blend between animations. |
| `animation.randomizeStart` | Start on a random clip instead of the first. |
| `camera.position` | `[x, y, z]` camera location. +Z is in front of the avatar. |
| `camera.target` | `[x, y, z]` point the camera looks at (e.g. the face/chest). |
| `camera.fov` | Field of view in degrees. Lower = more zoomed / flatter. |
| `zoom` | Dolly multiplier. `1` = as configured, `1.5` = 50% closer, `0.7` = further. |
| `transform.position` | `[x, y, z]` to move the avatar in the frame. |
| `transform.rotation` | `[x, y, z]` rotation in **degrees**. |
| `transform.scale` | Uniform scale of the avatar. |
| `background` | See below. |
| `lighting.environment` | `true` for soft image-based lighting (nicer PBR). |
| `lighting.ambientIntensity` | Flat fill light. |
| `lighting.directionalIntensity` | Key light strength. |
| `lighting.directionalPosition` | `[x, y, z]` direction the key light comes from. |

### Background modes

`RoomEnvironment` (`lighting.environment`) only *lights* the avatar — it is never
drawn as scenery. What you see behind the character is controlled by
`background`:

| Value | Result |
| --- | --- |
| `"transparent"` | Nothing is drawn; the page behind the canvas shows through. Use this to composite the avatar over your own content. |
| `"#101018"` (any CSS color) | Solid color fill. |
| `"environment"` | Renders the studio room as a soft, blurry backdrop. |
| `"/bg.jpg"` (a `.png`/`.jpg`/`.webp` path under `public/`) | Uses that image as the backdrop, stretched to fill. |

If you want a *photographic* room rather than the soft studio gradient, drop an
equirectangular image into `public/` and point `background` at it.

### Framing tips

- To show head-and-shoulders, lower `camera.position` z and raise the `target` y.
- To place the character off to one side (common for a background/overlay),
  shift `transform.position` x, e.g. `[-0.6, 0, 0]` to push them left.
- Keep `background: "transparent"` if you're compositing the avatar over your
  own page, image, or video — the page background shows through the canvas.

## Using it as an overlay in another app

The whole thing is a full-viewport, transparent canvas. To layer it over your
own content, either run it as-is and put your content behind it, or lift
`src/viewer/ViewerEngine.js` and `src/App.jsx` into your project and mount
`<App />` inside a positioned container.

## Tech

- `three` — 3D rendering
- `@pixiv/three-vrm` — VRM model loading
- `@pixiv/three-vrm-animation` — VRMA animation loading + retargeting
- `react` + `vite` — app shell and dev server
