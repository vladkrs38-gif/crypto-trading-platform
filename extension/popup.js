const statusCard = document.getElementById('statusCard')
const statusDot = document.getElementById('statusDot')
const statusText = document.getElementById('statusText')
const statusHint = document.getElementById('statusHint')
const codeBlock = document.getElementById('codeBlock')
const codeValue = document.getElementById('codeValue')

chrome.storage.local.get('userCode', (data) => {
  if (data.userCode) {
    statusCard.className = 'status-card ok'
    statusText.textContent = 'Готово к работе'
    statusHint.textContent = 'Связка с сайтом установлена'
    codeBlock.style.display = 'block'
    codeValue.textContent = data.userCode
  } else {
    statusCard.className = 'status-card warn'
    statusText.textContent = 'Откройте сайт для связки'
    statusHint.textContent = 'Перейдите на proplatforma.ru/hh'
  }
})
