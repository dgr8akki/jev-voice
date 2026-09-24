// Side panels can't show Chrome's permission prompt, so this tab asks once on the extension's behalf.
const status = document.getElementById('status');

async function requestMicrophone() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    status.textContent = 'Microphone allowed. Close this tab and press Start listening in the side panel.';
    status.className = 'status-ok';
  } catch (error) {
    status.textContent = `Microphone blocked (${error.name}). Allow it from the icon in the address bar, then try again.`;
    status.className = 'status-error';
  }
}

document.getElementById('allow').addEventListener('click', requestMicrophone);
requestMicrophone();
