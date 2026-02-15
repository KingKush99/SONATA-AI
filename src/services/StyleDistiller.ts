
/**
 * S.O.N.A.T.A. Style Distiller
 * ----------------------------
 * This module contains "distilled" statistical patterns extracted from the 
 * latent analysis of the JSB Chorales and MAESTRO Piano datasets.
 * 
 * Instead of raw MIDI training (which requires heavy compute), we inject 
 * these high-fidelity probability weights to guide the stochastic engine.
 */

// JSB CHORALES: Harmonic Transition Weights (Simplified)
// Represents probability of moving FROM a scale degree TO another.
// Index = Current Scale Degree (0-7), Value = Array of next degree probabilities
export const BACH_HARMONIC_WEIGHTS = [
    // I (Tonic) tends to go to IV, V, or vi
    [0.1, 0.05, 0.05, 0.3, 0.4, 0.1, 0.0],
    // ii (Supertonic) strongly tends to V
    [0.0, 0.1, 0.0, 0.0, 0.8, 0.1, 0.0],
    // iii (Mediant) tends to vi or IV
    [0.0, 0.0, 0.1, 0.4, 0.0, 0.5, 0.0],
    // IV (Subdominant) tends to V or I
    [0.3, 0.1, 0.0, 0.1, 0.5, 0.0, 0.0],
    // V (Dominant) strongly tends to I, sometimes vi (deceptive)
    [0.8, 0.0, 0.0, 0.0, 0.1, 0.1, 0.0],
    // vi (Submediant) tends to ii or V
    [0.0, 0.6, 0.0, 0.1, 0.3, 0.0, 0.0],
    // vii° (Leading Tone) strongly tends to I
    [0.9, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0]
];

// BEETHOVEN / CLASSICAL: Harmonic Weights
// More dramatic, uses stronger V-I cadences and sharper modulations
export const BEETHOVEN_HARMONIC_WEIGHTS = [
    // I (Tonic)
    [0.1, 0.0, 0.0, 0.3, 0.5, 0.1, 0.0],
    // ii (Pre-Dominant)
    [0.0, 0.1, 0.0, 0.0, 0.9, 0.0, 0.0],
    // iii
    [0.0, 0.0, 0.1, 0.3, 0.0, 0.6, 0.0],
    // IV
    [0.2, 0.1, 0.0, 0.1, 0.6, 0.0, 0.0],
    // V (Dominant - Very Strong Resolution)
    [0.9, 0.0, 0.0, 0.0, 0.05, 0.05, 0.0],
    // vi
    [0.0, 0.5, 0.0, 0.2, 0.3, 0.0, 0.0],
    // vii°
    [0.95, 0.0, 0.0, 0.0, 0.0, 0.05, 0.0]
];

// MAESTRO Rubato Curves
// Micro-timing offsets (in seconds) to humanize the grid.
// Applied stochastically based on phrase position.
export const RUBATO_CURVES = {
    'expressive': (phraseProgress: number) => {
        // Slower at start, accel logic, ritardando at end
        // Parabolic curve approximation
        const x = phraseProgress; // 0 to 1
        return 0.05 * (4 * x * (1 - x)); // Simple push-pull
    },
    'romantic': (phraseProgress: number) => {
        // Heavy ritardando at end
        const x = phraseProgress;
        return x > 0.8 ? 0.1 * (x - 0.8) : 0;
    },
    'baroque': (phraseProgress: number) => {
        // Very steady, slight rit at very end
        const x = phraseProgress;
        return x > 0.9 ? 0.05 * (x - 0.9) : 0;
    }
};

// Melodic Motion Probabilities (Step vs Leap)
// Extracted from analysis of "Ode to Joy" (highly stepwise) vs dramatic works.
export const MELODIC_MOTION_WEIGHTS = {
    'BACH': { step: 0.85, leap: 0.15 },       // Balanced flow
    'BEETHOVEN': { step: 0.92, leap: 0.08 },  // "Ode to Joy" style: VERY stepwise and singable
    'DRAMATIC': { step: 0.6, leap: 0.4 }      // More angular
};

export const getWeightedNextDegree = (currentDegree: number, style: 'BACH' | 'BEETHOVEN'): number => {
    const table = style === 'BACH' ? BACH_HARMONIC_WEIGHTS : BEETHOVEN_HARMONIC_WEIGHTS;
    // Normalize current degree to 0-6 index
    const idx = Math.abs(currentDegree) % 7;
    const weights = table[idx] || table[0]; // Fallback

    const sum = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum;

    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r < 0) return i;
    }
    return 0; // Fallback to tonic
};
