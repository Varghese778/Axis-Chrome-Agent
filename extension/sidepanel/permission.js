const btn = document.getElementById('request-btn');
const success = document.getElementById('success-msg');

btn.onclick = async () => {
    console.log('Grant Access button clicked');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Microphone access granted successfully');

        // Stop the tracks immediately
        stream.getTracks().forEach(track => track.stop());

        const content = document.getElementById('request-content');
        if (content) content.style.display = 'none';
        success.style.display = 'block';

        // Automatically close after a delay
        setTimeout(() => {
            console.log('Closing window');
            window.close();
        }, 1500);
    } catch (err) {
        console.error('Permission request failed:', err);
        // More detailed error message
        let errorMsg = 'Could not access microphone: ' + err.message;
        if (err.name === 'NotAllowedError') {
            errorMsg = 'Microphone access was denied. Please allow the Mic acces from Extension Settings.';
        } else if (err.name === 'NotFoundError') {
            errorMsg = 'No microphone was found on this device.';
        }
        alert(errorMsg);
    }
};

// Just check state, don't auto-click (simulated clicks don't count as user gestures)
if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'microphone' }).then(result => {
        console.log('Initial microphone permission state:', result.state);
        if (result.state === 'granted') {
            btn.style.display = 'none';
            success.style.display = 'block';
            setTimeout(() => window.close(), 1000);
        }
        result.onchange = () => {
            console.log('Microphone permission changed to:', result.state);
            if (result.state === 'granted') {
                btn.style.display = 'none';
                success.style.display = 'block';
                setTimeout(() => window.close(), 1000);
            }
        };
    }).catch(e => console.error('Permissions query failed:', e));
}
