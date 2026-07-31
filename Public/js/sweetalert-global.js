"use strict";

(function initializeSweetAlert2() {
    const nativeAlert = window.alert.bind(window);

    if (typeof window.Swal === "undefined") {
        console.error(
            "SweetAlert2 chưa được tải. Hãy kiểm tra /vendor/sweetalert2/sweetalert2.min.js"
        );
        return;
    }

    const swal = window.Swal.mixin({
        confirmButtonText: "Đồng ý",
        cancelButtonText: "Hủy",
        reverseButtons: true,
        heightAuto: false,
        focusCancel: false
    });

    window.AppAlert = Object.freeze({
        fire(options) {
            return swal.fire(options);
        },

        success(message, title = "Thành công") {
            return swal.fire({
                icon: "success",
                title,
                text: String(message ?? "")
            });
        },

        error(message, title = "Đã xảy ra lỗi") {
            return swal.fire({
                icon: "error",
                title,
                text: String(message ?? "")
            });
        },

        warning(message, title = "Cảnh báo") {
            return swal.fire({
                icon: "warning",
                title,
                text: String(message ?? "")
            });
        },

        info(message, title = "Thông báo") {
            return swal.fire({
                icon: "info",
                title,
                text: String(message ?? "")
            });
        },

        confirm(message, options = {}) {
            return swal.fire({
                icon: options.icon || "warning",
                title: options.title || "Xác nhận thao tác",
                text: String(message ?? "Bạn có chắc chắn muốn tiếp tục?"),
                showCancelButton: true,
                confirmButtonText: options.confirmButtonText || "Đồng ý",
                cancelButtonText: options.cancelButtonText || "Hủy",
                confirmButtonColor: options.confirmButtonColor || "#d33",
                cancelButtonColor: options.cancelButtonColor || "#6c757d"
            });
        }
    });

    // Các lệnh alert() cũ trong JavaScript tương lai cũng hiển thị bằng SweetAlert2.
    window.alert = function sweetAlertReplacement(message) {
        if (window.AppAlert) {
            void window.AppAlert.info(message);
            return;
        }

        nativeAlert(message);
    };

    async function handleConfirmTrigger(event) {
        const trigger = event.target.closest("[data-confirm-message]");

        if (!trigger || trigger.dataset.swalConfirmed === "true") {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        const result = await window.AppAlert.confirm(
            trigger.dataset.confirmMessage || "Bạn có chắc chắn muốn tiếp tục?",
            {
                title: trigger.dataset.confirmTitle || "Xác nhận thao tác",
                confirmButtonText: trigger.dataset.confirmButtonText || "Đồng ý",
                cancelButtonText: trigger.dataset.cancelButtonText || "Hủy"
            }
        );

        if (!result.isConfirmed) {
            return;
        }

        if (trigger.matches("a[href]")) {
            window.location.assign(trigger.href);
            return;
        }

        const form = trigger.form || trigger.closest("form");

        if (!form) {
            return;
        }

        trigger.dataset.swalConfirmed = "true";

        if (typeof form.requestSubmit === "function") {
            form.requestSubmit(trigger);
        } else {
            form.submit();
        }
    }

    function showServerMessages() {
        document.querySelectorAll("[data-swal-message]").forEach(function (element) {
            if (element.dataset.swalShown === "true") {
                return;
            }

            const message = (element.dataset.swalMessage || "").trim();

            if (!message) {
                return;
            }

            element.dataset.swalShown = "true";

            void swal.fire({
                icon: element.dataset.swalIcon || "info",
                title: element.dataset.swalTitle || "Thông báo",
                text: message,
                confirmButtonText: element.dataset.swalConfirmText || "Đồng ý"
            });
        });
    }

    document.addEventListener("click", handleConfirmTrigger, true);

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", showServerMessages, { once: true });
    } else {
        showServerMessages();
    }
})();
