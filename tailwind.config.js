module.exports = {
  content: [
    './index.html',
    './js/**/*.{js}',
    './server/**/*.{js}'
  ],
  safelist: [
    // Dynamically added pill/tab classes
    'bg-slate-900',
    'text-white',
    'font-semibold',
    'scale-105',
    'shadow-md',
    'bg-white',
    'text-slate-600',
    'border',
    'border-slate-300'
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          500: '#3b82f6', // blue-500
          600: '#2563eb', // blue-600
          700: '#1d4ed8', // blue-700
        },
        success: {
          500: '#10b981', // emerald-500
          600: '#059669', // emerald-600
        }
      }
    }
  },
  plugins: []
};
