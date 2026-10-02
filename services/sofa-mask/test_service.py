import io
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from service import decode_image, encode_rle, mask_geometry, normalize_photo


class MaskContractTests(unittest.TestCase):
    def test_disconnected_parts_and_occlusion_holes_survive_bitmap(self):
        mask = np.zeros((40, 60), bool)
        mask[3:20, 4:25] = True
        mask[8:12, 9:14] = False
        mask[25:35, 40:55] = True
        counts = encode_rle(mask)['counts']
        decoded = np.concatenate([np.full(n, i % 2, np.uint8) for i, n in enumerate(counts)]).reshape(mask.shape)
        np.testing.assert_array_equal(mask, decoded)
        rings, bbox = mask_geometry(mask)
        self.assertEqual(sum(r['hole'] for r in rings), 1)
        self.assertEqual(sum(not r['hole'] for r in rings), 2)
        self.assertEqual(bbox, [4 / 60, 3 / 40, 51 / 60, 32 / 40])

    def test_rle_starts_with_background_even_if_first_pixel_is_foreground(self):
        mask = np.array([[1, 1, 0], [0, 1, 1]], bool)
        self.assertEqual(encode_rle(mask)['counts'], [0, 2, 2, 2])

    def test_encoded_photo_orientation_cannot_silently_misalign_masks(self):
        image = Image.new('RGB', (60, 40))
        exif = image.getexif()
        exif[274] = 6
        stream = io.BytesIO()
        image.save(stream, format='JPEG', exif=exif)
        with self.assertRaisesRegex(ValueError, 'rotation'):
            decode_image(stream.getvalue())

    def test_png_dimensions_and_colors_unchanged(self):
        pixels = np.zeros((12, 18, 3), np.uint8)
        pixels[3:7] = (255, 30, 80)
        stream = io.BytesIO()
        Image.fromarray(pixels).save(stream, format='PNG')
        np.testing.assert_array_equal(decode_image(stream.getvalue()), pixels)

    def test_exif_rotation_normalized_before_inference(self):
        image = Image.new('RGB', (60, 40), 'white')
        exif = image.getexif()
        exif[274] = 6
        stream = io.BytesIO()
        image.save(stream, format='JPEG', exif=exif)
        normalized, mime = normalize_photo(stream.getvalue())
        self.assertEqual(mime, 'image/jpeg')
        self.assertEqual(decode_image(normalized).shape, (60, 40, 3))

    def test_upright_photo_bytes_are_preserved(self):
        stream = io.BytesIO()
        Image.new('RGB', (60, 40), 'white').save(stream, format='JPEG')
        self.assertEqual(normalize_photo(stream.getvalue()), (stream.getvalue(), 'image/jpeg'))

    def test_large_phone_photo_is_stored_in_one_bounded_coordinate_system(self):
        stream = io.BytesIO()
        Image.new('RGB', (60, 40), 'white').save(stream, format='JPEG')
        with patch('service.MAX_PIXELS', 600):
            normalized, _ = normalize_photo(stream.getvalue())
            self.assertEqual(decode_image(normalized).shape, (20, 30, 3))


if __name__ == '__main__':
    unittest.main()
