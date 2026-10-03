import { createMovementCorrector } from './movementCorrection';

// Shared by the socket correction handler, the input sender (sent-position
// history and acknowledgements) and the scene update (blending).
export const localMovementCorrector = createMovementCorrector();
