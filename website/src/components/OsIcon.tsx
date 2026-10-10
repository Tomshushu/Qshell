import React from 'react';
import { Router, Cpu, Cable } from 'lucide-react';

export interface OsIconProps {
  osType?: string;
  osInfo?: string;
  targetType?: string;
  className?: string;
}

/** OS 图标组件，精准复刻 Qshell 桌面端的系统图标库 */
export const OsIcon: React.FC<OsIconProps> = ({ osType, osInfo, targetType, className = 'w-5 h-5' }) => {
  const os = (osType || '').toLowerCase().replace(/"/g, '').trim();
  const info = (osInfo || '').toLowerCase().replace(/"/g, '').trim();
  const tt = (targetType || '').toLowerCase().trim();
  const combined = `${os} ${info}`.trim();

  // 1. 网络设备
  if (os === 'network' || tt === 'network') {
    return (
      <div className={`flex items-center justify-center bg-cyan-600/20 text-cyan-400 rounded-lg ${className}`}>
        <Router className="h-3/5 w-3/5" />
      </div>
    );
  }

  // 2. BMC 带外管理
  if (tt === 'bmc' || os === 'bmc') {
    return (
      <div className={`flex items-center justify-center bg-orange-600/20 text-orange-400 rounded-lg ${className}`}>
        <Cpu className="h-3/5 w-3/5" />
      </div>
    );
  }

  // 3. 串口
  if (tt === 'serial' || os === 'serial') {
    return (
      <div className={`flex items-center justify-center bg-emerald-600/20 text-emerald-400 rounded-lg ${className}`}>
        <Cable className="h-3/5 w-3/5" />
      </div>
    );
  }

  // 4. Windows
  if (os.includes('windows') || tt === 'windows' || os === 'winnt' || os === 'mingw' || os === 'msys') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="8" height="8" fill="#F25022" />
        <rect x="13" y="3" width="8" height="8" fill="#7FBA00" />
        <rect x="3" y="13" width="8" height="8" fill="#00A4EF" />
        <rect x="13" y="13" width="8" height="8" fill="#FFB900" />
      </svg>
    );
  }

  // 5. macOS / Darwin
  if (os.includes('darwin') || os.includes('mac') || combined.includes('macos') || combined.includes('osx')) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#1E293B" stroke="#334155" strokeWidth="0.5" />
        <path
          d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
          fill="white"
        />
      </svg>
    );
  }

  // 6. 阿里云 Alibaba Cloud Linux (alinux / aliyun)
  if (os === 'alinux' || os === 'aliyun' || os === 'alibaba' || /(alinux|aliyun|alibaba|alibabacloud)/.test(combined)) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#FF6A00" />
        <g transform="translate(4, 4)">
          <path d="M8 1.5L14.2 5.1L8 8.7L1.8 5.1Z" fill="#FFFFFF" />
          <path d="M1.2 6.3L7.4 9.9V14.5L1.2 10.9Z" fill="#FFFFFF" fillOpacity="0.75" />
          <path d="M8.6 9.9L14.8 6.3V10.9L8.6 14.5Z" fill="#FFFFFF" fillOpacity="0.9" />
        </g>
      </svg>
    );
  }

  // 7. 腾讯云 TencentOS / TencentOS Server / TLinux
  if (os === 'tencentos' || os === 'tlinux' || /(tencentos|tlinux|tencent)/.test(combined)) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#0052D9" />
        <g transform="translate(3.5, 4.5)">
          <path
            d="M8.5 0.5C5.46 0.5 3 2.96 3 6C3 6.3 3.03 6.6 3.08 6.88C1.3 7.6 0 9.4 0 11.5C0 14.26 2.24 16.5 5 16.5H12C14.76 16.5 17 14.26 17 11.5C17 9.08 15.28 7.06 13 6.6C12.7 3.2 9.9 0.5 8.5 0.5ZM8.5 2.5C9.4 2.5 11.1 4.5 11.2 6.8C9.5 7.1 8 8.4 7.6 10.2C6.9 9.8 6 9.5 5 9.5C4.2 9.5 3.4 9.7 2.8 10.2C3.1 8.5 4.5 7.1 6.2 6.9C6.4 4.5 7.3 2.5 8.5 2.5Z"
            fill="white"
          />
        </g>
      </svg>
    );
  }

  // 8. 华为云 EulerOS / HCE
  if (os === 'euleros' || os === 'hce' || /(euleros|hce|huawei)/.test(combined)) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#C7000B" />
        <g transform="translate(4, 4)">
          <path d="M8 1.2C8.3 2.8 8.3 5 8 6.5C7.7 5 7.7 2.8 8 1.2Z" fill="white" />
          <path d="M4.5 2.4C5.5 3.7 6.6 5.4 7 7C5.9 6.2 4.4 4.7 4.5 2.4Z" fill="white" />
          <path d="M11.5 2.4C11.6 4.7 10.1 6.2 9 7C9.4 5.4 10.5 3.7 11.5 2.4Z" fill="white" />
          <path d="M1.8 5.2C3.3 6 5.3 7 6.4 8.2C5 8 3.2 7.1 1.8 5.2Z" fill="white" />
          <path d="M14.2 5.2C12.8 7.1 11 8 9.6 8.2C10.7 7 12.7 6 14.2 5.2Z" fill="white" />
          <circle cx="8" cy="14.5" r="1.1" fill="white" />
        </g>
      </svg>
    );
  }

  // 9. openEuler
  if (os === 'openeuler' || /(openeuler)/.test(combined)) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#002FA7" />
        <g transform="translate(4, 4)">
          <path d="M8 1L15 4.5V11.5L8 15L1 11.5V4.5L8 1Z" stroke="white" strokeWidth="1.2" fill="none" />
          <path d="M8 4L12.5 6.5V11L8 13.5L3.5 11V6.5L8 4Z" fill="white" fillOpacity="0.3" />
          <circle cx="8" cy="8" r="2.2" fill="white" />
        </g>
      </svg>
    );
  }

  // 10. 亚马逊云 AWS Amazon Linux
  if (os === 'amzn' || os === 'amazon' || /(amzn|amazon|aws)/.test(combined)) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#232F3E" />
        <g transform="translate(3, 4.5)">
          <text x="9" y="8.5" textAnchor="middle" fill="#FFFFFF" fontSize="7.5" fontWeight="bold" fontFamily="sans-serif">
            aws
          </text>
          <path d="M3 10.5C7 13.2 11 13.2 15 10.5" stroke="#FF9900" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      </svg>
    );
  }

  // 11. 银河麒麟 Kylin
  if (os === 'kylin' || os === 'neokylin' || os === 'ukylin' || /(kylin|neokylin)/.test(combined)) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#D32F2F" />
        <g transform="translate(3.5, 3.5)">
          <path
            d="M8.5 1C4.36 1 1 4.36 1 8.5C1 12.64 4.36 16 8.5 16C12.64 16 16 12.64 16 8.5C16 4.36 12.64 1 8.5 1ZM12.2 12.5C10.8 13.8 8.8 14.4 6.8 13.8C7.5 13.1 8.1 12.2 8.4 11.2C8.6 11.3 8.8 11.3 9 11.3C10.2 11.3 11.3 10.6 11.8 9.5C12.5 10.6 12.6 11.7 12.2 12.5ZM13.8 8.2C13.6 9.4 12.9 10.3 11.8 10.7C11.5 8.9 10.2 7.5 8.5 7.2C8.8 6.4 9.4 5.8 10.2 5.5C11.8 6 13.2 7 13.8 8.2ZM6.5 4.2C7.5 4.8 8.2 5.8 8.3 6.9C7.2 7.2 6.2 8 5.7 9.1C5.2 8.1 5.2 6.8 5.8 5.7C6 5.2 6.2 4.7 6.5 4.2Z"
            fill="white"
          />
        </g>
      </svg>
    );
  }

  // 12. 统信 UOS / Deepin
  if (os === 'uos' || os === 'deepin' || /(uos|deepin)/.test(combined)) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#0081FF" />
        <g transform="translate(4, 5.5)">
          <path
            d="M4.5 1C2 1 0 3 0 5.5C0 8 2 10 4.5 10C7.2 10 9 7.8 10.5 5.5C12 3.2 13.8 1 16.5 1C19 1 21 3 21 5.5C21 8 19 10 16.5 10C13.8 10 12 7.8 10.5 5.5C9 3.2 7.2 1 4.5 1ZM4.5 3C5.8 3 7.2 4.3 8.3 6C7.2 7.7 5.8 9 4.5 9C2.6 9 1 7.4 1 5.5C1 3.6 2.6 3 4.5 3ZM16.5 3C18.4 3 20 4.6 20 6.5C20 8.4 18.4 9 16.5 9C15.2 9 13.8 7.7 12.7 6C13.8 4.3 15.2 3 16.5 3Z"
            fill="white"
            transform="scale(0.75)"
          />
        </g>
      </svg>
    );
  }

  // 13. Ubuntu
  if (os === 'ubuntu' || /(ubuntu)/.test(combined)) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#E95420" />
        <path
          d="M2.273 9.53a2.273 2.273 0 1 0 0-4.546 2.273 2.273 0 0 0 0 4.547Zm9.467-4.984a2.273 2.273 0 1 0 0-4.546 2.273 2.273 0 0 0 0 4.546M7.4 13.108a5.54 5.54 0 0 1-3.775-2.88 3.27 3.27 0 0 1-1.944.24 7.4 7.4 0 0 0 5.328 4.465c.53.113 1.072.169 1.614.166a3.25 3.25 0 0 1-.666-1.9 6 6 0 0 1-.557-.091m3.828 2.285a2.273 2.273 0 1 0 0-4.546 2.273 2.273 0 0 0 0 4.546m3.163-3.108a7.44 7.44 0 0 0 .373-8.726 3.3 3.3 0 0 1-1.278 1.498 5.57 5.57 0 0 1-.183 5.535 3.26 3.26 0 0 1 1.088 1.693M2.098 3.998a3.3 3.3 0 0 1 1.897.486 5.54 5.54 0 0 1 4.464-2.388c.037-.67.277-1.313.69-1.843a7.47 7.47 0 0 0-7.051 3.745"
          fill="white"
          transform="translate(4, 4)"
        />
      </svg>
    );
  }

  // 14. CentOS
  if (os === 'centos' || /(centos)/.test(combined)) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#2E3036" />
        <g transform="translate(4, 4) scale(0.125)">
          <path d="M59.033 64.192l-27.305 26.66-27.302-26.66 27.302-26.651zm0 0" fill="#932279" />
          <path d="M64.72 58.736L37.824 31.91 64.72 5.084 91.61 31.91zm0 0" fill="#efa724" />
          <path d="M91.675 96.563l-27.307 26.661-27.3-26.661 27.302-26.65zm0 0" fill="#9ccd2a" />
          <path d="M97.362 91.108L70.466 64.277l26.895-26.821 26.895 26.821zm0 0" fill="#262577" />
          <path d="M70.066 69.484h36.461v36.401H70.066zm0 0" fill="#efa724" />
          <path d="M70.216 22.454h36.577v36.231H70.216zm0 0" fill="#932279" />
          <path d="M21.1 69.484h38.084v37.753H21.1zm0 0" fill="#262577" />
          <path d="M21.1 20.928h38.084v37.538H21.1zm0 0" fill="#9ccd2a" />
        </g>
      </svg>
    );
  }

  // 15. RedHat / RHEL
  if (os === 'redhat' || os === 'rhel' || /(redhat|rhel|red\s*hat)/.test(combined)) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#CC0000" />
        <path
          d="M16.009 13.386c1.577 0 3.86-.326 3.86-2.202a1.765 1.765 0 0 0-.04-.431l-.94-4.08c-.216-.898-.406-1.305-1.982-2.093-1.223-.625-3.888-1.658-4.676-1.658-.733 0-.947.946-1.822.946-.842 0-1.467-.706-2.255-.706-.757 0-1.25.515-1.63 1.576 0 0-1.06 2.99-1.197 3.424a.81.81 0 0 0-.028.245c0 1.162 4.577 4.974 10.71 4.974m4.101-1.435c.218 1.032.218 1.14.218 1.277 0 1.765-1.984 2.745-4.593 2.745-5.895.004-11.06-3.451-11.06-5.734a2.326 2.326 0 0 1 .19-.925C2.746 9.415 0 9.794 0 12.217c0 3.969 9.405 8.861 16.851 8.861 5.71 0 7.149-2.582 7.149-4.62 0-1.605-1.387-3.425-3.887-4.512"
          fill="white"
          transform="translate(1, 1) scale(0.9)"
        />
      </svg>
    );
  }

  // 16. Debian
  if (os === 'debian' || /(debian|kali|mint)/.test(combined)) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#D70A53" />
        <g transform="translate(4, 4) scale(0.125)">
          <path
            d="M73.776 67.531c-2.065.028.391 1.063 3.087 1.479a27.453 27.453 0 002.023-1.741c-1.679.41-3.387.419-5.11.262m11.086-2.763c1.229-1.697 2.127-3.556 2.442-5.478-.276 1.369-1.019 2.553-1.72 3.801-3.86 2.431-.363-1.443-.002-2.916-4.15 5.225-.57 3.133-.72 4.593m4.093-10.648c.249-3.72-.733-2.544-1.063-1.125.384.201.69 2.622 1.063 1.125"
            fill="white"
          />
          <path
            d="M66.926 61.137v29.89c0 16.54-13.41 29.953-29.95 29.953-2.511 0-4.296-.285-6.617-.89-3.39-.887-6.156-3.664-6.16-6.895 0-3.906 2.836-6.746 7.074-6.746 2.016 0 2.747.387 5.704.387 8.718 0 15.793-7.063 15.808-15.785V77.312c0-1.23-1-2.23-2.234-2.226l-10.387-.004c-3.867 0-6.996-3.086-6.996-6.965 0-3.906 3.16-6.98 7.07-6.98"
            fill="#fff"
          />
        </g>
      </svg>
    );
  }

  // 17. Arch Linux
  if (os === 'arch' || /(arch|manjaro)/.test(combined)) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#1793D1" />
        <path
          d="M11.39.605C10.376 3.092 9.764 4.72 8.635 7.132c.693.734 1.543 1.589 2.923 2.554-1.484-.61-2.496-1.224-3.252-1.86C6.86 10.842 4.596 15.138 0 23.395c3.612-2.085 6.412-3.37 9.021-3.862a6.61 6.61 0 01-.171-1.547l.003-.115c.058-2.315 1.261-4.095 2.687-3.973 1.426.12 2.534 2.096 2.478 4.409a6.52 6.52 0 01-.146 1.243c2.58.505 5.352 1.787 8.914 3.844-.702-1.293-1.33-2.459-1.929-3.57-.943-.73-1.926-1.682-3.933-2.713 1.38.359 2.367.772 3.137 1.234-6.09-11.334-6.582-12.84-8.67-17.74z"
          fill="white"
          transform="translate(1, 1) scale(0.9)"
        />
      </svg>
    );
  }

  // 18. Alpine Linux
  if (os === 'alpine' || /(alpine)/.test(combined)) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#0D597F" />
        <path
          d="M5.998 1.607L0 12l5.998 10.393h12.004L24 12 18.002 1.607H5.998zM9.965 7.12L12.66 9.9l1.598 1.595.002-.002 2.41 2.363c-.2.14-.386.252-.563.344a3.756 3.756 0 01-.496.217 2.702 2.702 0 01-.425.111c-.131.023-.25.034-.358.034-.13 0-.242-.014-.338-.034a1.317 1.317 0 01-.24-.072.95.95 0 01-.2-.113l-1.062-1.092-3.039-3.041-1.1 1.053-3.07 3.072a.974.974 0 01-.2.111 1.274 1.274 0 01-.237.073c-.096.02-.209.033-.338.033-.108 0-.227-.009-.358-.031a2.7 2.7 0 01-.425-.114 3.748 3.748 0 01-.496-.217 5.228 5.228 0 01-.563-.343l6.803-6.727z"
          fill="white"
          transform="translate(1, 1) scale(0.9)"
        />
      </svg>
    );
  }

  // 19. openSUSE
  if (['opensuse', 'suse', 'sles'].includes(os) || /(opensuse|suse)/.test(combined)) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#73BA25" />
        <path
          d="M10.724 0a12 12 0 0 0-9.448 4.623c1.464.391 2.5.727 2.81.832.005-.19.037-1.893.037-1.893s.004-.04.025-.06c.026-.026.065-.018.065-.018.385.056 8.602 1.274 12.066 3.292.427.25.638.517.902.786.958.99 2.223 5.108 2.359 5.957.005.033-.036.07-.054.083a5.177 5.177 0 0 1-.313.228c-.82.55-2.708 1.872-5.13 1.656-2.176-.193-5.018-1.44-8.445-3.699.336.79.668 1.58 1 2.371.497.258 5.287 2.7 7.651 2.651 1.904-.04 3.941-.968 4.756-1.458 0 0 .179-.108.257-.048.085.066.061.167.041.27-.05.234-.164.66-.242.863l-.065.165c-.093.25-.183.482-.356.625-.48.436-1.246.784-2.446 1.305-1.855.812-4.865 1.328-7.66 1.31-1.001-.022-1.968-.133-2.817-.232-1.743-.197-3.161-.357-4.026.269A12 12 0 0 0 10.724 24a12 12 0 0 0 12-12 12 12 0 0 0-12-12z"
          fill="white"
          transform="translate(1, 1) scale(0.9)"
        />
      </svg>
    );
  }

  // 20. 默认：通用 Linux (Tux)
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="5" fill="#334155" />
      <path
        d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046"
        fill="white"
        transform="translate(1.5, 1.5) scale(0.875)"
      />
    </svg>
  );
};
