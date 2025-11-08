module.exports = {
  content: [
    './index.html',
    './js/**/*.{js}',
    './server/**/*.{js}'
  ],
  theme: {
    extend: {
      colors: {
        'primary': {
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        'success': {
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
        'danger': {
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
        }
      }
    }
  },
  plugins: []
};


