const form = document.querySelector('#imageForm');
const status = document.querySelector('#status');
const image = document.querySelector('#generatedImage');
const types = document.querySelectorAll('.type');
let selectedType = 'מוצר';

types.forEach((button) => button.addEventListener('click', () => {
  types.forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  selectedType = button.dataset.type;
}));

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const button = form.querySelector('.create-button');
  button.innerHTML = '<span>✦</span> יוצרים את הקסם...';
  button.disabled = true;
  status.textContent = 'מייצרים עבורך';
  image.style.filter = 'brightness(.82) saturate(.85)';
  setTimeout(() => {
    const palettes = ['linear-gradient(130deg,#bf765f,#d9957e 45%,#e6b699)', 'linear-gradient(130deg,#617d70,#91a48b 44%,#d6c394)', 'linear-gradient(130deg,#536d8b,#93b5c9 45%,#edd2aa)', 'linear-gradient(130deg,#9e5049,#dc8b71 48%,#ebc98d)'];
    image.style.background = palettes[Math.floor(Math.random() * palettes.length)];
    image.style.filter = 'none';
    status.textContent = `${selectedType} חדש מוכן`;
    button.innerHTML = '<span>✦</span> צרו תמונה נוספת';
    button.disabled = false;
  }, 950);
});
