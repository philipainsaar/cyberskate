# Cyber Skate Full (GLB Integrated)

This version of the Next.js + Three.js skate game now loads the real uploaded assets:

- `public/models/skater.glb`
- `public/models/skate-park.glb`

The game uses the custom skater model and custom skate-park model as the main visuals.

## Included features

- Custom rigged skater GLB loaded at runtime
- Custom skate-park GLB loaded at runtime
- Third-person camera locked behind the skater's back
- Dual-axis swipe controls for mobile
- Keyboard controls for desktop
- Procedural skateboard sound effects in the browser
- Automatic ground detection using raycasts against the park model
- Automatic solid collision boxes generated from park meshes and boundaries
- Basic grind detection on meshes that look like rails
- Fallback procedural skater if a GLB fails to load

## Run

```bash
npm install
npm run dev
```

Then open the local Next.js URL.

## Controls

### Mobile

- Small swipe up: push forward fast
- Swipe up-left / up-right: push and carve at the same time
- Drag left/right while moving: carve/turn
- Drag left/right while stopped: aim turn in place
- Drag down: brake only
- Fast bigger swipe up: ollie/jump
- Tap: quick trick

### Desktop

- `W` / `Arrow Up`: push forward
- `S` / `Arrow Down`: brake only
- `A` / `D` or `Left` / `Right`: turn
- `Space`: ollie
- `F`: trick

## Notes

Because the skate park is now loaded from a real GLB, the collision is generated automatically from the meshes. That means this build should work immediately, but you may still want a later polish pass for:

- exact skater facing direction
- final skater scale
- exact spawn point
- exact rail detection
- animation clip selection if the GLB contains multiple actions
- hand-tuned collision volumes for perfect ramp / ledge behavior

## Main file

- `components/CyberSkateGame.jsx`

## Assets

- `public/models/skater.glb`
- `public/models/skate-park.glb`
- `public/reference/style-reference-01.jpg`
- `public/reference/style-reference-02.jpg`
- `public/reference/style-reference-03.jpg`
