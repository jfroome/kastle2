/* Layout used only for cycle profiling in an emulator: code/rodata in "flash", data in a big RAM */
MEMORY
{
  FLASH (rx) : ORIGIN = 0x10000000, LENGTH = 16M
  RAM (rwx)  : ORIGIN = 0x20000000, LENGTH = 32M
}
ENTRY(fw_boot)
SECTIONS
{
  .text : { *(.text*) *(.rodata*) KEEP(*(.init)) KEEP(*(.fini)) *(.eh_frame*) } > FLASH
  .ARM.extab : { *(.ARM.extab*) } > FLASH
  .ARM.exidx : { __exidx_start = .; *(.ARM.exidx*) __exidx_end = .; } > FLASH
  .preinit_array : { __preinit_array_start = .; KEEP(*(.preinit_array*)) __preinit_array_end = .; } > FLASH
  .init_array : { __init_array_start = .; KEEP(*(SORT(.init_array.*))) KEEP(*(.init_array*)) __init_array_end = .; } > FLASH
  .fini_array : { __fini_array_start = .; KEEP(*(.fini_array*)) __fini_array_end = .; } > FLASH
  .data : { *(.data*) } > RAM
  .bss (NOLOAD) : { *(.bss*) *(COMMON) } > RAM
  _end = .;
  __stack_top = ORIGIN(RAM) + LENGTH(RAM);
}
