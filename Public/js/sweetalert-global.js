'use strict';

/*
 * =====================================================
 * SWEETALERT2 DÙNG CHUNG CHO TOÀN WEBSITE
 * =====================================================
 *
 * Phải tải theo đúng thứ tự:
 *
 * 1. /vendor/sweetalert2/sweetalert2.min.css
 * 2. /vendor/sweetalert2/sweetalert2.min.js
 * 3. /js/sweetalert-global.js
 */

(function initializeSweetAlert2() {
    const nativeAlert =
        window.alert.bind(window);

    /*
     * Kiểm tra SweetAlert2 đã tải chưa.
     */
    if (
        typeof window.Swal === 'undefined' ||
        typeof window.Swal.fire !== 'function'
    ) {
        console.error(
            '[SweetAlert2] Không tải được thư viện. ' +
            'Hãy kiểm tra /vendor/sweetalert2/sweetalert2.min.js'
        );

        return;
    }

    console.log(
        '[SweetAlert2] Đã tải thành công bản JS và CSS tách riêng.'
    );

    /*
     * Cấu hình mặc định.
     */
    const appSwal =
        window.Swal.mixin({
            confirmButtonText:
                'Đồng ý',

            cancelButtonText:
                'Hủy',

            confirmButtonColor:
                '#3085d6',

            cancelButtonColor:
                '#6c757d',

            reverseButtons: true,

            heightAuto: false,

            allowEscapeKey: true,

            allowOutsideClick: true,

            focusConfirm: true,

            focusCancel: false
        });

    /*
     * API dùng chung cho website.
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
                title = 'Thành công'
            ) {
                return appSwal.fire({
                    icon: 'success',
                    title,
                    text:
                        String(
                            message ??
                            ''
                        )
                });
            },

            error(
                message,
                title = 'Đã xảy ra lỗi'
            ) {
                return appSwal.fire({
                    icon: 'error',
                    title,
                    text:
                        String(
                            message ??
                            ''
                        )
                });
            },

            warning(
                message,
                title = 'Cảnh báo'
            ) {
                return appSwal.fire({
                    icon: 'warning',
                    title,
                    text:
                        String(
                            message ??
                            ''
                        )
                });
            },

            info(
                message,
                title = 'Thông báo'
            ) {
                return appSwal.fire({
                    icon: 'info',
                    title,
                    text:
                        String(
                            message ??
                            ''
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
                        'warning',

                    title:
                        options.title ||
                        'Xác nhận thao tác',

                    text:
                        String(
                            message ??
                            'Bạn có chắc chắn muốn tiếp tục?'
                        ),

                    showCancelButton: true,

                    confirmButtonText:
                        options.confirmButtonText ||
                        'Đồng ý',

                    cancelButtonText:
                        options.cancelButtonText ||
                        'Hủy',

                    confirmButtonColor:
                        options.confirmButtonColor ||
                        '#d33',

                    cancelButtonColor:
                        options.cancelButtonColor ||
                        '#6c757d',

                    allowOutsideClick: false
                });
            }
        });

    /*
     * Chuyển alert() thông thường thành SweetAlert2.
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
     * Xử lý phần tử có:
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

        if (!clickedElement) {
            return;
        }

        const trigger =
            clickedElement.closest(
                '[data-confirm-message]'
            );

        if (
            !trigger ||
            trigger.dataset.swalConfirmed ===
                'true'
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
                    'Bạn có chắc chắn muốn tiếp tục?',
                {
                    title:
                        trigger.dataset
                            .confirmTitle ||
                        'Xác nhận thao tác',

                    confirmButtonText:
                        trigger.dataset
                            .confirmButtonText ||
                        'Đồng ý',

                    cancelButtonText:
                        trigger.dataset
                            .cancelButtonText ||
                        'Hủy'
                }
            );

        if (!result.isConfirmed) {
            return;
        }

        if (
            trigger.matches(
                'a[href]'
            )
        ) {
            window.location.assign(
                trigger.href
            );

            return;
        }

        const form =
            trigger.form ||
            trigger.closest(
                'form'
            );

        if (!form) {
            return;
        }

        trigger.dataset.swalConfirmed =
            'true';

        if (
            typeof form.requestSubmit ===
            'function'
        ) {
            form.requestSubmit(
                trigger
            );
        } else {
            form.submit();
        }
    }

    /*
     * Hiển thị thông báo do server đưa vào HTML:
     *
     * <div
     *     data-swal-message="Thông báo"
     *     data-swal-icon="success"
     *     data-swal-title="Thành công">
     * </div>
     */
    async function showServerMessages() {
        const messageElements =
            Array.from(
                document.querySelectorAll(
                    '[data-swal-message]'
                )
            );

        for (
            const element
            of messageElements
        ) {
            if (
                element.dataset.swalShown ===
                'true'
            ) {
                continue;
            }

            const message =
                (
                    element.dataset
                        .swalMessage ||
                    ''
                ).trim();

            if (!message) {
                element.remove();
                continue;
            }

            const icon =
                element.dataset
                    .swalIcon ||
                'info';

            const title =
                element.dataset
                    .swalTitle ||
                'Thông báo';

            const confirmButtonText =
                element.dataset
                    .swalConfirmText ||
                'Đồng ý';

            element.dataset.swalShown =
                'true';

            /*
             * Xóa thẻ khỏi trang trước khi mở popup.
             */
            element.remove();

            await appSwal.fire({
                icon,
                title,
                text: message,
                confirmButtonText
            });
        }
    }

    /*
     * Bắt xác nhận trước các event listener khác.
     */
    document.addEventListener(
        'click',
        handleConfirmTrigger,
        true
    );

    /*
     * Chờ DOM hoàn tất.
     */
    if (
        document.readyState ===
        'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            () => {
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