#pragma once
#include "pico/types.h"
typedef struct uart_inst { int index; } uart_inst_t;
extern uart_inst_t emu_uart0_inst;
#define uart0 (&emu_uart0_inst)
#ifdef __cplusplus
extern "C"
{
#endif
    uint uart_init(uart_inst_t *uart, uint baudrate);
    void uart_set_fifo_enabled(uart_inst_t *uart, bool enabled);
    bool uart_is_readable(uart_inst_t *uart);
    uint8_t uart_getc(uart_inst_t *uart);
#ifdef __cplusplus
}
#endif
