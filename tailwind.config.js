/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#2a1320',
        paper: '#fff1f7',
        accent: '#db2777',
        berry: '#be185d',
        gold: '#b45309',
      },
      boxShadow: {
        soft: '0 20px 60px rgba(190, 24, 93, 0.10)',
      },
    },
  },
  plugins: [],
};
