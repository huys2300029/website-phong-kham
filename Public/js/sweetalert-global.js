'use strict';

/*
 * =====================================================
 * TƯƠNG THÍCH MÃ CŨ SAU KHI GỠ SWEETALERT2
 * =====================================================
 *
 * File này không tải SweetAlert2 và không chèn CSS nội tuyến.
 * Nó chỉ chuyển các lệnh Swal cũ sang AppDialog dùng Bootstrap.
 * Có thể xóa file này khi toàn bộ mã cũ đã đổi sang AppDialog.
 */
(function legacySweetAlertCompatibility() {
    function waitForAppDialog() {
        if (
            window.AppDialog &&
            typeof window.AppDialog.fire === 'function'
        ) {
            return Promise.resolve(window.AppDialog);
        }

        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 100;

            const timer = window.setInterval(() => {
                attempts += 1;

                if (
                    window.AppDialog &&
                    typeof window.AppDialog.fire === 'function'
                ) {
                    window.clearInterval(timer);
                    resolve(window.AppDialog);
                    return;
                }

                if (attempts >= maxAttempts) {
                    window.clearInterval(timer);
                    reject(
                        new Error(
                            'AppDialog chưa được tải. ' +
                            'Hãy tải /js/bootstrap-ui.js trước khi gọi Swal.fire().'
                        )
                    );
                }
            }, 25);
        });
    }

    const compatibilityApi = {
        async fire(...args) {
            const dialog = await waitForAppDialog();
            return dialog.fire(...args);
        },

        mixin(defaultOptions = {}) {
            return Object.freeze({
                fire: async (first, second, third) => {
                    const dialog = await waitForAppDialog();
                    const current =
                        first &&
                        typeof first === 'object' &&
                        !Array.isArray(first)
                            ? first
                            : {
                                  title: first,
                                  text: second,
                                  icon: third
                              };

                    return dialog.fire({
                        ...defaultOptions,
                        ...current
                    });
                }
            });
        },

        async showLoading() {
            const dialog = await waitForAppDialog();
            return dialog.showLoading();
        },

        async showValidationMessage(message) {
            const dialog = await waitForAppDialog();
            return dialog.showValidationMessage(message);
        },

        async close() {
            const dialog = await waitForAppDialog();
            return dialog.close();
        }
    };

    window.Swal = compatibilityApi;
})();
