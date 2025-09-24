# HEIC File Support

OpenPaint now supports HEIC (High Efficiency Image Container) files, which are commonly used by modern iPhones and other Apple devices.

## Features

- **Automatic Detection**: HEIC and HEIF files are automatically detected by file extension and MIME type
- **Client-Side Conversion**: HEIC files are converted to JPEG format in the browser using the `heic2any` library
- **High Quality**: Conversion uses 90% quality to maintain image fidelity
- **User Feedback**: Status messages inform users when conversion is in progress
- **Error Handling**: Failed conversions are logged and reported to the user

## Supported File Types

- `.heic` files
- `.heif` files
- Files with MIME type `image/heic`
- Files with MIME type `image/heif`

## How It Works

1. When files are dropped or selected, the system checks if they are HEIC/HEIF files
2. If a HEIC file is detected, it's automatically converted to JPEG format
3. The converted file is then processed normally by the application
4. The original filename is preserved but with a `.jpg` extension

## Technical Implementation

- Uses the `heic2any` library (v0.0.4) loaded via CDN
- Conversion happens client-side to avoid server dependencies
- Converted files are stored as `File` objects with proper MIME types
- The conversion process is asynchronous and non-blocking

## Browser Compatibility

HEIC support requires a modern browser that supports:
- WebAssembly (for the heic2any library)
- File API
- Blob API

Most modern browsers (Chrome 57+, Firefox 52+, Safari 11+, Edge 16+) support these features.

## Error Handling

If HEIC conversion fails:
- An error message is displayed to the user
- The file is skipped and not processed
- The error is logged to the console for debugging
- The application continues processing other files normally
