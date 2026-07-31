'use strict';

/*
 * =====================================================
 * THÔNG BÁO VÀ HỘP THOẠI BẰNG BOOTSTRAP
 * =====================================================
 *
 * Không tự chèn CSS; toàn bộ giao diện nằm trong file CSS tĩnh.
 * Toàn bộ CSS nằm trong /Public/css/bootstrap-ui.css.
 */
(function bootstrapUiModule() {
    const ICONS = Object.freeze({
        success: '✓',
        error: '×',
        warning: '!',
        info: 'i',
        question: '?'
    });

    const VALID_TYPES = new Set([
        'success',
        'error',
        'warning',
        'info',
        'question'
    ]);

    let activeDialog = null;

    function normalizeType(type) {
        return VALID_TYPES.has(type)
            ? type
            : 'info';
    }

    function text(value, fallback = '') {
        return value === undefined || value === null
            ? fallback
            : String(value);
    }

    function ensureBootstrap() {
        if (
            typeof window.bootstrap === 'undefined' ||
            typeof window.bootstrap.Modal !== 'function' ||
            typeof window.bootstrap.Toast !== 'function'
        ) {
            throw new Error(
                'Bootstrap JavaScript chưa được tải. ' +
                'Hãy tải bootstrap.bundle.min.js trước bootstrap-ui.js.'
            );
        }
    }

    function ensureToastContainer() {
        let container = document.getElementById('appToastContainer');

        if (container) {
            return container;
        }

        container = document.createElement('div');
        container.id = 'appToastContainer';
        container.className =
            'toast-container position-fixed top-0 end-0 p-3 app-toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'true');

        document.body.appendChild(container);
        return container;
    }

    function createToast(options) {
        const type = normalizeType(options.type);
        const title = text(options.title, 'Thông báo');
        const message = text(options.message);
        const delay = Number.isFinite(Number(options.delay))
            ? Math.max(1000, Number(options.delay))
            : 4500;

        const toast = document.createElement('div');
        toast.className = `toast app-toast app-toast--${type}`;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        toast.setAttribute('aria-atomic', 'true');

        const header = document.createElement('div');
        header.className = 'toast-header gap-2';

        const icon = document.createElement('span');
        icon.className = 'app-toast__icon';
        icon.textContent = ICONS[type] || ICONS.info;
        icon.setAttribute('aria-hidden', 'true');

        const heading = document.createElement('strong');
        heading.className = 'me-auto';
        heading.textContent = title;

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'btn-close';
        closeButton.setAttribute('data-bs-dismiss', 'toast');
        closeButton.setAttribute('aria-label', 'Đóng');

        const body = document.createElement('div');
        body.className = 'toast-body';
        body.textContent = message;

        header.append(icon, heading, closeButton);
        toast.append(header, body);

        const container = ensureToastContainer();
        container.appendChild(toast);

        const instance = window.bootstrap.Toast.getOrCreateInstance(
            toast,
            {
                autohide: options.autohide !== false,
                delay
            }
        );

        toast.addEventListener(
            'hidden.bs.toast',
            () => {
                instance.dispose();
                toast.remove();
            },
            { once: true }
        );

        instance.show();
        return instance;
    }

    window.AppNotify = Object.freeze({
        show(message, options = {}) {
            return createToast({
                ...options,
                message
            });
        },

        success(message, title = 'Thành công', options = {}) {
            return createToast({
                ...options,
                type: 'success',
                title,
                message
            });
        },

        error(message, title = 'Đã xảy ra lỗi', options = {}) {
            return createToast({
                ...options,
                type: 'error',
                title,
                message,
                autohide: options.autohide ?? false
            });
        },

        warning(message, title = 'Cảnh báo', options = {}) {
            return createToast({
                ...options,
                type: 'warning',
                title,
                message
            });
        },

        info(message, title = 'Thông báo', options = {}) {
            return createToast({
                ...options,
                type: 'info',
                title,
                message
            });
        }
    });

    function ensureDialogElement() {
        let modalElement = document.getElementById('appDialogModal');

        if (modalElement) {
            return modalElement;
        }

        modalElement = document.createElement('div');
        modalElement.id = 'appDialogModal';
        modalElement.className = 'modal fade app-dialog-modal';
        modalElement.tabIndex = -1;
        modalElement.setAttribute('aria-hidden', 'true');
        modalElement.setAttribute('aria-labelledby', 'appDialogTitle');

        modalElement.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header border-0">
                        <div class="app-dialog-heading">
                            <span class="app-dialog-icon d-none" data-app-dialog-icon aria-hidden="true"></span>
                            <h5 class="modal-title" id="appDialogTitle" data-app-dialog-title></h5>
                        </div>
                        <button type="button" class="btn-close d-none" data-app-dialog-close aria-label="Đóng"></button>
                    </div>
                    <div class="modal-body">
                        <div class="app-dialog-message" data-app-dialog-message></div>
                        <div class="app-dialog-html" data-app-dialog-html></div>
                        <div class="alert alert-danger app-dialog-validation d-none" role="alert" data-app-dialog-validation></div>
                        <div class="app-dialog-loading d-none" data-app-dialog-loading>
                            <div class="spinner-border text-primary" role="status" aria-hidden="true"></div>
                            <span>Đang xử lý, vui lòng chờ...</span>
                        </div>
                        <div class="app-dialog-footer small text-muted mt-3" data-app-dialog-footer></div>
                    </div>
                    <div class="modal-footer" data-app-dialog-actions>
                        <button type="button" class="btn btn-secondary" data-app-dialog-cancel>Hủy</button>
                        <button type="button" class="btn btn-primary" data-app-dialog-confirm>Đồng ý</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modalElement);
        return modalElement;
    }

    function normalizeDialogOptions(first, second, third) {
        if (
            first &&
            typeof first === 'object' &&
            !Array.isArray(first)
        ) {
            return { ...first };
        }

        return {
            title: first,
            text: second,
            icon: third
        };
    }

    function buttonClassFromColor(color, fallback) {
        const normalized = text(color).toLowerCase();

        if (
            normalized.includes('d33') ||
            normalized.includes('dc3545') ||
            normalized.includes('danger')
        ) {
            return 'btn-danger';
        }

        if (
            normalized.includes('28a745') ||
            normalized.includes('198754') ||
            normalized.includes('success')
        ) {
            return 'btn-success';
        }

        if (
            normalized.includes('ffc107') ||
            normalized.includes('warning')
        ) {
            return 'btn-warning';
        }

        return fallback;
    }

    function applyDialogSize(dialog, width) {
        dialog.classList.remove('modal-sm', 'modal-lg', 'modal-xl');

        const numericWidth = Number.parseInt(text(width), 10);

        if (Number.isFinite(numericWidth) && numericWidth >= 850) {
            dialog.classList.add('modal-xl');
        } else if (Number.isFinite(numericWidth) && numericWidth >= 520) {
            dialog.classList.add('modal-lg');
        }
    }

    async function closeActiveDialog(reason = 'replaced') {
        if (!activeDialog) {
            return;
        }

        const current = activeDialog;

        if (!current.pendingResult) {
            current.pendingResult = {
                isConfirmed: false,
                isDenied: false,
                isDismissed: true,
                dismiss: reason
            };
        }

        await new Promise((resolve) => {
            const timeout = window.setTimeout(resolve, 250);

            current.element.addEventListener(
                'hidden.bs.modal',
                () => {
                    window.clearTimeout(timeout);
                    resolve();
                },
                { once: true }
            );

            current.instance.hide();
        });
    }

    function showLoading() {
        if (!activeDialog) {
            return;
        }

        activeDialog.loading.classList.remove('d-none');
        activeDialog.confirmButton.disabled = true;
        activeDialog.cancelButton.disabled = true;
    }

    function showValidationMessage(message) {
        if (!activeDialog) {
            return;
        }

        activeDialog.validationShown = true;
        activeDialog.validation.textContent = text(message);
        activeDialog.validation.classList.remove('d-none');
        activeDialog.loading.classList.add('d-none');
        activeDialog.confirmButton.disabled = false;
        activeDialog.cancelButton.disabled = false;
    }

    async function fire(first, second, third) {
        ensureBootstrap();
        await closeActiveDialog();

        const options = normalizeDialogOptions(first, second, third);
        const type = normalizeType(options.icon);
        const element = ensureDialogElement();
        const dialog = element.querySelector('.modal-dialog');
        const actions = element.querySelector('[data-app-dialog-actions]');
        const icon = element.querySelector('[data-app-dialog-icon]');
        const titleElement = element.querySelector('[data-app-dialog-title]');
        const messageElement = element.querySelector('[data-app-dialog-message]');
        const htmlElement = element.querySelector('[data-app-dialog-html]');
        const footerElement = element.querySelector('[data-app-dialog-footer]');
        const validation = element.querySelector('[data-app-dialog-validation]');
        const loading = element.querySelector('[data-app-dialog-loading]');
        const closeButton = element.querySelector('[data-app-dialog-close]');
        const cancelButton = element.querySelector('[data-app-dialog-cancel]');
        const confirmButton = element.querySelector('[data-app-dialog-confirm]');

        applyDialogSize(dialog, options.width);

        icon.className = `app-dialog-icon app-dialog-icon--${type}`;
        icon.textContent = ICONS[type];
        icon.classList.toggle('d-none', !options.icon);

        titleElement.textContent = text(options.title, 'Thông báo');
        messageElement.textContent = text(options.text);

        if (options.html !== undefined && options.html !== null) {
            htmlElement.innerHTML = text(options.html);
        } else {
            htmlElement.replaceChildren();
        }

        if (options.footer !== undefined && options.footer !== null) {
            footerElement.innerHTML = text(options.footer);
        } else {
            footerElement.replaceChildren();
        }

        validation.textContent = '';
        validation.classList.add('d-none');
        loading.classList.add('d-none');

        confirmButton.innerHTML = text(options.confirmButtonText, 'Đồng ý');
        cancelButton.innerHTML = text(options.cancelButtonText, 'Hủy');

        confirmButton.className =
            `btn ${buttonClassFromColor(options.confirmButtonColor, 'btn-primary')}`;
        cancelButton.className =
            `btn ${buttonClassFromColor(options.cancelButtonColor, 'btn-secondary')}`;

        const showConfirmButton = options.showConfirmButton !== false;
        const showCancelButton = options.showCancelButton === true;

        confirmButton.classList.toggle('d-none', !showConfirmButton);
        cancelButton.classList.toggle('d-none', !showCancelButton);
        closeButton.classList.toggle('d-none', options.showCloseButton !== true);
        actions.classList.toggle('d-none', !showConfirmButton && !showCancelButton);
        actions.classList.toggle('app-dialog-reverse', options.reverseButtons === true);

        confirmButton.disabled = false;
        cancelButton.disabled = false;

        const oldInstance = window.bootstrap.Modal.getInstance(element);

        if (oldInstance) {
            oldInstance.dispose();
        }

        const instance = new window.bootstrap.Modal(
            element,
            {
                backdrop: options.allowOutsideClick === false
                    ? 'static'
                    : true,
                keyboard: options.allowEscapeKey !== false,
                focus: options.focusConfirm !== false
            }
        );

        return new Promise((resolve) => {
            let timerId = null;
            let settled = false;

            activeDialog = {
                element,
                instance,
                confirmButton,
                cancelButton,
                validation,
                loading,
                validationShown: false,
                pendingResult: null
            };

            function settle(result) {
                if (settled) {
                    return;
                }

                settled = true;
                activeDialog.pendingResult = result;
                instance.hide();
            }

            closeButton.onclick = () => {
                settle({
                    isConfirmed: false,
                    isDenied: false,
                    isDismissed: true,
                    dismiss: 'close'
                });
            };

            cancelButton.onclick = () => {
                settle({
                    isConfirmed: false,
                    isDenied: false,
                    isDismissed: true,
                    dismiss: 'cancel'
                });
            };

            confirmButton.onclick = async () => {
                validation.classList.add('d-none');
                activeDialog.validationShown = false;

                let value = true;

                if (typeof options.preConfirm === 'function') {
                    confirmButton.disabled = true;
                    cancelButton.disabled = true;

                    try {
                        value = await options.preConfirm();
                    } catch (error) {
                        showValidationMessage(
                            error && error.message
                                ? error.message
                                : 'Không thể xử lý dữ liệu.'
                        );
                        return;
                    }

                    if (
                        value === false ||
                        activeDialog.validationShown
                    ) {
                        confirmButton.disabled = false;
                        cancelButton.disabled = false;
                        return;
                    }
                }

                settle({
                    isConfirmed: true,
                    isDenied: false,
                    isDismissed: false,
                    value
                });
            };

            element.addEventListener(
                'shown.bs.modal',
                () => {
                    if (typeof options.didOpen === 'function') {
                        options.didOpen(element);
                    }

                    if (Number.isFinite(Number(options.timer))) {
                        timerId = window.setTimeout(
                            () => {
                                settle({
                                    isConfirmed: false,
                                    isDenied: false,
                                    isDismissed: true,
                                    dismiss: 'timer'
                                });
                            },
                            Math.max(0, Number(options.timer))
                        );
                    }
                },
                { once: true }
            );

            element.addEventListener(
                'hidden.bs.modal',
                () => {
                    if (timerId !== null) {
                        window.clearTimeout(timerId);
                    }

                    const result = activeDialog && activeDialog.pendingResult
                        ? activeDialog.pendingResult
                        : {
                              isConfirmed: false,
                              isDenied: false,
                              isDismissed: true,
                              dismiss: 'backdrop'
                          };

                    activeDialog = null;
                    instance.dispose();
                    resolve(result);
                },
                { once: true }
            );

            instance.show();
        });
    }

    window.AppDialog = Object.freeze({
        fire,
        showLoading,
        showValidationMessage,

        close() {
            void closeActiveDialog('close');
        },

        mixin(defaultOptions = {}) {
            return Object.freeze({
                fire(first, second, third) {
                    const current = normalizeDialogOptions(first, second, third);
                    return fire({
                        ...defaultOptions,
                        ...current
                    });
                }
            });
        }
    });

    window.alert = function bootstrapAlert(message) {
        window.AppNotify.info(message);
    };

    function showEmbeddedMessages() {
        const elements = Array.from(
            document.querySelectorAll('[data-app-message]')
        );

        for (const element of elements) {
            const message = text(element.dataset.appMessage).trim();

            if (!message) {
                element.remove();
                continue;
            }

            const type = normalizeType(element.dataset.appType);
            const title = text(element.dataset.appTitle, 'Thông báo');

            window.AppNotify.show(message, {
                type,
                title,
                autohide: type !== 'error'
            });

            element.remove();
        }
    }

    function showQueryMessage() {
        const url = new URL(window.location.href);
        const message = url.searchParams.get('uiMessage');

        if (!message) {
            return;
        }

        const type = normalizeType(
            url.searchParams.get('uiType') || 'info'
        );
        const title = url.searchParams.get('uiTitle') || 'Thông báo';

        window.AppNotify.show(message, {
            type,
            title,
            autohide: type !== 'error'
        });

        url.searchParams.delete('uiMessage');
        url.searchParams.delete('uiType');
        url.searchParams.delete('uiTitle');

        window.history.replaceState(
            null,
            document.title,
            `${url.pathname}${url.search}${url.hash}`
        );
    }

    function initialize() {
        ensureBootstrap();
        showEmbeddedMessages();
        showQueryMessage();
    }

    if (document.readyState === 'loading') {
        document.addEventListener(
            'DOMContentLoaded',
            initialize,
            { once: true }
        );
    } else {
        initialize();
    }
})();
