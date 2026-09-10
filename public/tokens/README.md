# Token icons

Drop transparent-background PNG (or holographic 3D render) icons here, named by
lowercase symbol:

    eth.png   usdc.png   sol.png   btc.png   link.png   uni.png

`SwipeCard` loads `/tokens/<symbol>.png`. If a file is missing it renders a
crisp brand-coloured fallback badge (Viem token palette) instead — the deck
never shows a broken image.

Recommended: 128×128 or 256×256, transparent, centred with a little padding.
