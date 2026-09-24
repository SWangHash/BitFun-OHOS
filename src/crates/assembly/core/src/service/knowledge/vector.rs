//! Vector blob encoding and cosine similarity for the knowledge index.
//!
//! Vectors are stored as plain little-endian float32 bytes in a SQLite BLOB
//! (engine-portable, mirroring Cherry Studio's storage contract). Similarity is
//! a brute-force cosine scan computed in Rust; there is no ANN index.

/// Encode a vector as raw little-endian float32 bytes.
pub(crate) fn encode_vector(vector: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

/// Decode raw little-endian float32 bytes into a vector. Trailing partial bytes
/// are ignored, so a corrupt/odd-length blob degrades to a shorter vector
/// instead of panicking.
pub(crate) fn decode_vector(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

/// Cosine similarity in `[-1, 1]`. Returns `0.0` for zero-norm or
/// mismatched-length vectors (undefined similarity), so callers never see NaN.
pub(crate) fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }
    if norm_a <= f32::EPSILON || norm_b <= f32::EPSILON {
        return 0.0;
    }
    dot / (norm_a.sqrt() * norm_b.sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_vector_bytes() {
        let vector = vec![0.5f32, -1.25, 3.0];
        let decoded = decode_vector(&encode_vector(&vector));
        assert_eq!(decoded, vector);
    }

    #[test]
    fn cosine_of_identical_vectors_is_one() {
        let vector = vec![1.0f32, 2.0, 3.0];
        assert!((cosine_similarity(&vector, &vector) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_of_orthogonal_vectors_is_zero() {
        assert!(cosine_similarity(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6);
    }
}
