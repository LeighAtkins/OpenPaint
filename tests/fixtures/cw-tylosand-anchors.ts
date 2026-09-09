/** Independent visual reference endpoints on the original 2007 × 708 images.
 * Used only by regression evaluation, never by the placement algorithm.
 * The gallery defines the span; these points mark that span on each source view.
 */
export const tylosandAnchors: Record<string, Record<string, [number, number, number, number]>> = {
  'Frame Cover': {
    'Front panel width': [116, 245, 1780, 580],
    'Front panel height': [781, 379, 784, 475],
    'Side width': [1905, 205, 1780, 615],
  },
  'Seat Cushion Cover': {
    Width: [625, 210, 1413, 282],
    Height: [1088, 34, 772, 474],
    Thickness: [1488, 152, 1563, 278],
  },
  'Back Cushion Cover': {
    Width: [625, 178, 1415, 282],
    Height: [1068, 30, 756, 423],
    Thickness: [1525, 117, 1610, 255],
  },
  'Side Cushion Cover': {
    Width: [609, 228, 1448, 240],
    Height: [1098, 39, 807, 473],
    Thickness: [1518, 126, 1560, 273],
  },
  'Accent Cushion Cover': {
    'Width (Top)': [850, 120, 1390, 43],
    'Width (Bottom)': [647, 575, 1290, 617],
    Height: [1080, 93, 908, 616],
    'Thickness (Bottom)': [908, 616, 918, 635],
  },
};
