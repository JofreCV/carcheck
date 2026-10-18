import { showView } from './ui.js';

function setupNavigation() {
  for (const tab of document.querySelectorAll('.tabbar button')) {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  }
}

setupNavigation();
