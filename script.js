        function copyIP() {
            const ipText = document.getElementById('ipAddress').innerText;
            
            navigator.clipboard.writeText(ipText).then(() => {
                showToast();
            }).catch(err => {
                const textarea = document.createElement('textarea');
                textarea.value = ipText;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                showToast();
            });
        }

        function showToast() {
            const toast = document.getElementById('toast');
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
            }, 2000);
        }