document.addEventListener('DOMContentLoaded', function() {
    // Check if the necessary elements exist (for the purchase page)
    const decreaseButton = document.querySelector('.decrease');
    const increaseButton = document.querySelector('.increase');
    const ticketCountSpan = document.querySelector('.ticket-count');
    const ticketQuantityInput = document.getElementById('ticket-quantity');
    const subtotalPriceSpan = document.getElementById('subtotal-price');
    const ticketPrice = 10.00;

    function updateTicketCount(newCount) {
        ticketCountSpan.textContent = newCount;
        ticketQuantityInput.value = newCount;
        subtotalPriceSpan.textContent = (newCount * ticketPrice).toFixed(2);
    }

    // Only add these event listeners if the purchase page elements exist
    if (decreaseButton && increaseButton && ticketCountSpan && ticketQuantityInput && subtotalPriceSpan) {
        decreaseButton.addEventListener('click', function() {
            let count = parseInt(ticketCountSpan.textContent, 10);
            if (count > 1) { // prevent going below 1
                count--;
                updateTicketCount(count);
            }
        });

        increaseButton.addEventListener('click', function() {
            let count = parseInt(ticketCountSpan.textContent, 10);
            count++;
            updateTicketCount(count);
        });

        // Add event listener for form submission to create a Stripe Checkout Session.
        // This is now outside the increase button's event listener.
        const form = document.getElementById('checkout-form');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('email').value;
                const quantity = ticketQuantityInput.value;
                // Save the ticket quantity in localStorage for use in the success page
                localStorage.setItem("ticketQuantity", quantity);
                try {
                    const response = await fetch('/create-checkout-session', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, quantity })
                    });
                    const data = await response.json();
                    if (data.url) {
                        window.location.href = data.url;
                    } else {
                        alert('Error: No checkout URL returned.');
                    }
                } catch (err) {
                    console.error(err);
                    alert('An error occurred while processing your request.');
                }
            });
        }
    }
});

document.addEventListener("DOMContentLoaded", () => {
    // This block is for the success page (cart.html)
    // Parse URL query parameters
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const email = params.get("email");

    // Retrieve quantity from localStorage (if you stored it during checkout)
    // or default to 1 if not available.
    const quantity = localStorage.getItem("ticketQuantity") || 1;

    // Ensure that we have the necessary data before making the request
    if (sessionId && email) {
        fetch('/record-ticket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: email,
                quantity: parseInt(quantity, 10),
                stripeSessionId: sessionId
            })
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    console.log("Tickets recorded successfully:", data.tickets);
                    // Optionally, update the page UI to show the recorded tickets
                } else {
                    console.error("Error recording tickets:", data);
                }
            })
            .catch(error => {
                console.error("Request failed:", error);
            });
    } else {
        console.error("Missing session_id or email in query parameters.");
    }
});

// === QR Code Scanner Integration ===
// Only initialize if the scanner elements are present on the page
document.addEventListener('DOMContentLoaded', function() {
    const readerElement = document.getElementById('reader');
    const qrResultElement = document.getElementById('qr-result');
    if (readerElement && qrResultElement && typeof Html5Qrcode !== 'undefined') {
        const html5QrCode = new Html5Qrcode("reader");
        function onScanSuccess(decodedText, decodedResult) {
            // Stop scanning after a result to prevent duplicates
            html5QrCode.stop().catch(err => console.warn('Failed to stop scanner:', err));
            // Send scanned value to backend for validation
            fetch('/check-qr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ qrValue: decodedText })
            })
            .then(response => response.json())
            .then(data => {
                let color, message;
                if (data.found) {
                    if (!data.scanned) {
                        color = 'green';
                        message = 'Ticket Valid';
                    } else {
                        color = 'red';
                        message = 'Ticket Already Scanned';
                    }
                } else {
                    color = 'orange';
                    message = 'Ticket Not In Database';
                }

                qrResultElement.innerHTML = `${message} <br><button id="scan-again">Scan Another</button>`;
                qrResultElement.style.color = color;

                document.getElementById('scan-again').addEventListener('click', function() {
                    qrResultElement.innerText = 'Scan a QR code to see the result here';
                    qrResultElement.style.color = 'black';
                    html5QrCode.start(
                        { facingMode: "environment" },
                        { fps: 10, qrbox: 250 },
                        onScanSuccess
                    ).catch(err => {
                        qrResultElement.innerText = `QR Scanner Error: ${err}`;
                        qrResultElement.style.color = 'orange';
                    });
                });
            })
            .catch(error => {
                qrResultElement.innerHTML = 'Error checking ticket <br><button id="scan-again">Scan Another</button>';
                qrResultElement.style.color = 'orange';

                document.getElementById('scan-again').addEventListener('click', function() {
                    qrResultElement.innerText = 'Scan a QR code to see the result here';
                    qrResultElement.style.color = 'black';
                    html5QrCode.start(
                        { facingMode: "environment" },
                        { fps: 10, qrbox: 250 },
                        onScanSuccess
                    ).catch(err => {
                        qrResultElement.innerText = `QR Scanner Error: ${err}`;
                        qrResultElement.style.color = 'orange';
                    });
                });
            });
        }
        html5QrCode.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: 250 },
            onScanSuccess
        ).catch(err => {
            qrResultElement.innerText = `QR Scanner Error: ${err}`;
        });
    }
});