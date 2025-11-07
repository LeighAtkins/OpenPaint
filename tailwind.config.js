module.exports = {
  content: [
    './index.html',
    './js/**/*.{js}',
    './server/**/*.{js}'
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
