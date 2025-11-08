module.exports = {
  content: [
    './index.html',
    './public/**/*.html',
    './js/**/*.{js}',
    './public/js/**/*.{js}',
    './server/**/*.{js}'
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          500: 'rgb(59 130 246)',   // Blue
          600: 'rgb(37 99 235)',     // Darker blue
          700: 'rgb(29 78 216)'      // Even darker blue
        },
        success: {
          500: 'rgb(16 185 129)',    // Green
          600: 'rgb(5 150 105)'      // Darker green
        }
      }
    }
  },
  safelist: [
    // Copy button classes
    'flex', 'items-center', 'gap-1', 'px-3', 'py-1',
    'bg-primary-500', 'hover:bg-primary-600', 'active:bg-primary-700',
    'text-white', 'text-xs', 'rounded-lg', 'shadow-sm', 'hover:shadow-md',
    'transition-all', 'duration-200', 'transform',
    'hover:scale-[1.02]', 'active:scale-95',
    'w-3.5', 'h-3.5', 'opacity-90',
    'label-long', 'label-short',
    // Save button classes
    'bg-success-500', 'hover:bg-success-600',
    // Common utility classes that might be purged
    'relative', 'z-20', 'gap-2'
  ],
  plugins: []
};


