# Maria WebGPT 5.13.3

Completes the Astra picker compatibility fix for layouts where the model submenu replaces both the header and Power row. Maria recognizes that the model list is already open instead of trying to press a missing Select model control. The same handling applies when verifying a compact Pro control in a retained conversation.

Includes the 5.13.2 fixes for disabled menu transitions, compact generation labels, and the five-retry stream failure. The real Electron regression now also covers model-list-only layouts during selection and final verification on Windows, macOS, and Linux. Generic Pro still requires actual GPT-6 evidence from the owned picker.
