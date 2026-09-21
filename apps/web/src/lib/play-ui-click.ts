/**
 * Grounded intentionally keeps the imported world renderer silent. The
 * reference city's click helper is retained as an integration seam so the
 * original interaction code can run without pulling its unrelated audio UI
 * into the resilience application.
 */
export function playUiClickSound(): void {}
