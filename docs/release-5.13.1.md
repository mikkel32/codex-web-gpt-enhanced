# Maria WebGPT 5.13.1

Astra Pro now rechecks its model badge immediately before Send, after prompt preparation and uploads. The check also covers retained conversations that skip model selection. If the model changed, the effort was lowered, or the control disappeared, submission stops before Send activation.

Cancellation during Astra selection now stops further picker actions and preserves the cancellation reason. It cannot trigger the menu's pointer fallback after cancellation, and a disabled power control is rejected.

Regression tests exercise the actual Send method, picker cancellation, and changed/missing model badges. This patch does not add unverified Astra effort levels or switch conversations to another model.
