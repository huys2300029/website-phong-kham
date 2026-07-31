"use strict";

/*
 * =====================================================
 * SWEETALERT2 DÙNG CHUNG CHO TOÀN WEBSITE
 * =====================================================
 *
 * Yêu cầu phải tải trước file này:
 *
 * /vendor/sweetalert2/sweetalert2.all.min.js
 */

(function initializeSweetAlert2() {
    const nativeAlert =
        window.alert.bind(window);

    /*
     * Kiểm tra thư viện SweetAlert2 đã tải thành công chưa.
     */
    if (
        typeof window.Swal === "undefined" ||
        typeof window.Swal.fire !== "function"
    ) {
        console.error(
            "[SweetAlert2] Không tải được thư viện. " +
            "Hãy kiểm tra đường dẫn " +
            "/vendor/sweetalert2/sweetalert2.all.min.js"
        );

        return;
    }

    console.log(
        "[SweetAlert2] Thư viện đã được tải thành công."
    );

    /*
     * Cấu hình chung cho tất cả thông báo.
     */
    const appSwal =
        window.Swal.mixin({
            confirmButtonText: "Đồng ý",
            cancelButtonText: "Hủy",

            confirmButtonColor: "#3085d6",
            cancelButtonColor: "#6c757d",

            reverseButtons: true,
            heightAuto: false,

            allowEscapeKey: true,
            allowOutsideClick: true,

            focusConfirm: true,
            focusCancel: false
        });

    /*
     * API thông báo dùng chung.
     */
    window.AppAlert =
        Object.freeze({
            fire(options = {}) {
                return appSwal.fire(
                    options
                );
            },

            success(
                message,
                title = "Thành công"
            ) {
                return appSwal.fire({
                    icon: "success",
                    title,
                    text: String(
                        message ?? ""
                    )
                });
            },

            error(
                message,
                title = "Đã xảy ra lỗi"
            ) {
                return appSwal.fire({
                    icon: "error",
                    title,
                    text: String(
                        message ?? ""
                    )
                });
            },

            warning(
                message,
                title = "Cảnh báo"
            ) {
                return appSwal.fire({
                    icon: "warning",
                    title,
                    text: String(
                        message ?? ""
                    )
                });
            },

            info(
                message,
                title = "Thông báo"
            ) {
                return appSwal.fire({
                    icon: "info",
                    title,
                    text: String(
                        message ?? ""
                    )
                });
            },

            confirm(
                message,
                options = {}
            ) {
                return appSwal.fire({
                    icon:
                        options.icon ||
                        "warning",

                    title:
                        options.title ||
                        "Xác nhận thao tác",

                    text:
                        String(
                            message ??
                            "Bạn có chắc chắn muốn tiếp tục?"
                        ),

                    showCancelButton: true,

                    confirmButtonText:
                        options.confirmButtonText ||
                        "Đồng ý",

                    cancelButtonText:
                        options.cancelButtonText ||
                        "Hủy",

                    confirmButtonColor:
                        options.confirmButtonColor ||
                        "#d33",

                    cancelButtonColor:
                        options.cancelButtonColor ||
                        "#6c757d",

                    allowOutsideClick: false
                });
            }
        });

    /*
     * Thay alert() thông thường bằng SweetAlert2.
     */
    window.alert =
        function sweetAlertReplacement(
            message
        ) {
            if (
                window.AppAlert
            ) {
                void window.AppAlert.info(
                    message
                );

                return;
            }

            nativeAlert(
                message
            );
        };

    /*
     * Xử lý các nút hoặc liên kết có:
     *
     * data-confirm-message="Bạn chắc chắn muốn xóa?"
     */
    async function handleConfirmTrigger(
        event
    ) {
        const clickedElement =
            event.target instanceof Element
                ? event.target
                : null;

        if (
            !clickedElement
        ) {
            return;
        }

        const trigger =
            clickedElement.closest(
                "[data-confirm-message]"
            );

        if (
            !trigger ||
            trigger.dataset.swalConfirmed ===
                "true"
        ) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const result =
            await window.AppAlert.confirm(
                trigger.dataset
                    .confirmMessage ||
                    "Bạn có chắc chắn muốn tiếp tục?",
                {
                    title:
                        trigger.dataset
                            .confirmTitle ||
                        "Xác nhận thao tác",

                    confirmButtonText:
                        trigger.dataset
                            .confirmButtonText ||
                        "Đồng ý",

                    cancelButtonText:
                        trigger.dataset
                            .cancelButtonText ||
                        "Hủy"
                }
            );

        if (
            !result.isConfirmed
        ) {
            return;
        }

        /*
         * Nếu là liên kết thì điều hướng sau khi xác nhận.
         */
        if (
            trigger.matches(
                "a[href]"
            )
        ) {
            window.location.assign(
                trigger.href
            );

            return;
        }

        /*
         * Nếu là nút trong form thì gửi form.
         */
        const form =
            trigger.form ||
            trigger.closest(
                "form"
            );

        if (
            !form
        ) {
            return;
        }

        trigger.dataset.swalConfirmed =
            "true";

        if (
            typeof form.requestSubmit ===
            "function"
        ) {
            form.requestSubmit(
                trigger
            );
        } else {
            form.submit();
        }
    }

    /*
     * Hiển thị thông báo được server truyền qua thẻ:
     *
     * <div
     *   data-swal-message="Nội dung"
     *   data-swal-icon="error"
     *   data-swal-title="Thông báo">
     * </div>
     */
    async function showServerMessages() {
        const messageElements =
            Array.from(
                document.querySelectorAll(
                    "[data-swal-message]"
                )
            );

        for (
            const element
            of messageElements
        ) {
            if (
                element.dataset.swalShown ===
                "true"
            ) {
                continue;
            }

            const message =
                (
                    element.dataset
                        .swalMessage ||
                    ""
                ).trim();

            if (
                !message
            ) {
                element.remove();
                continue;
            }

            element.dataset.swalShown =
                "true";

            /*
             * Xóa thẻ thông báo khỏi giao diện.
             * Thông báo chỉ được hiển thị bằng popup.
             */
            element.remove();

            await appSwal.fire({
                icon:
                    element.dataset
                        .swalIcon ||
                    "info",

                title:
                    element.dataset
                        .swalTitle ||
                    "Thông báo",

                text:
                    message,

                confirmButtonText:
                    element.dataset
                        .swalConfirmText ||
                    "Đồng ý"
            });
        }
    }

    /*
     * Bắt sự kiện xác nhận trước các listener khác.
     */
    document.addEventListener(
        "click",
        handleConfirmTrigger,
        true
    );

    /*
     * Chờ HTML tải xong mới đọc thông báo từ server.
     */
    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            function onReady() {
                void showServerMessages();
            },
            {
                once: true
            }
        );
    } else {
        void showServerMessages();
    }
})();