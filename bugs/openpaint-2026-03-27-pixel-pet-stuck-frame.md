# Bug: Pixel Pet — Stuck Frame After Auth / Overlay Not Cleaned Up

**Date:** 2026-03-27
**Severity:** Low (visual glitch)
**Status:** Open
**Reporter:** Tarkovsky 🦞
**Branch:** `mos-overlay`

## Description

After auth on initial load, the pixel pet animation gets stuck and a frozen frame of it remains visible on screen. The pet appears to freeze in place and does not respond to cursor movement.

## Root Cause

In `src/modules/ui/pets-system.ts`, on login the pet auto-mounts via:

```ts
authService.onAuthStateChange(user => {
  if (user) {
    const unsub = walletService.onChange(state => {
      if (state.equippedPet && !petFollowerRenderer.isMounted()) {
        petFollowerRenderer.mount(state.equippedPet);
      }
      unsub();
    });
  }
});
```

**Race condition:** `unsub()` is called inside the first `onChange` callback. If the wallet has not loaded yet, `equippedPet` is null, the condition fails, and `unsub()` fires — permanently unsubscribing. The wallet loads later with the equipped pet, but no listener remains.

The renderer does handle overlay re-attachment (`if (!this.overlay.isConnected) document.body.appendChild(this.overlay)`), but canvas context loss during DOM mutations can cause a frozen frame.

## Key Files

| File | Role |
|---|---|
| `src/modules/ui/pets-system.ts` | Auth listener, Ctrl+Shift+P shortcut, auto-mount on login |
| `src/services/pets/petFollowerRenderer.ts` | Animation loop, overlay management, sprite rendering |
| `src/services/wallet/walletService.ts` | Pet equip state, coin balance |

## Suggested Fix

1. Do not unsubscribe until the pet is successfully mounted:
   ```ts
   unsub(); // move this AFTER petFollowerRenderer.mount()
   ```
2. Add canvas context validation in the tick loop
3. Ensure `petFollowerRenderer.unmount()` is called during canvas re-initialization
