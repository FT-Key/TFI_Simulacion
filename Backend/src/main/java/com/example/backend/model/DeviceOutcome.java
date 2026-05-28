package com.example.backend.model;

/** Resultado del triaje inicial de cada dispositivo. */
public enum DeviceOutcome {
    /** Condición OK + antigüedad < 7 años → inventario de reacondicionamiento. */
    REFURBISHED,
    /** Destrucción total / componentes peligrosos → disposición final controlada. */
    TERMINAL_WASTE,
    /** Chasis inoperable pero módulos internos útiles → cola de desensamblaje. */
    DISASSEMBLY
}
